#!/usr/bin/env bash
# Manual deploy of the server and the agent worker to Cloud Run (same steps as .github/workflows/deploy.yml).
# Usage: scripts/deploy.sh <gcp-project-id> [prod|staging]
# Needs gcloud and docker, logged in (gcloud auth login) with the deploy roles from docs/deploy.md.
set -euo pipefail
PROJECT="${1:?gcp project id}"
TARGET="${2:-prod}"
REGION="${GCP_REGION:-europe-west1}"
MAX="${MAX_INSTANCES:-1}"
TAG="$(git rev-parse --short HEAD)"
REPO="$REGION-docker.pkg.dev/$PROJECT/openblah"

gcloud config set project "$PROJECT" >/dev/null
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
for part in server agent; do
  docker build -f "packages/$part/Dockerfile" -t "$REPO/$part:$TAG" .
  docker push "$REPO/$part:$TAG"
done

# Optional secrets are used only if they exist in Secret Manager.
extra=""
for v in OPENBLAH_PRODUCT_KEYS OPENBLAH_AGENT_SECRET KEY_ENCRYPTION_SECRET; do
  if gcloud secrets describe "$v" >/dev/null 2>&1; then extra="$extra,$v=$v:latest"; fi
done
LK="LIVEKIT_URL=LIVEKIT_URL:latest,LIVEKIT_API_KEY=LIVEKIT_API_KEY:latest,LIVEKIT_API_SECRET=LIVEKIT_API_SECRET:latest"

gcloud run deploy "openblah-agent-$TARGET" --image "$REPO/agent:$TAG" --region "$REGION" \
  --min-instances 0 --max-instances "$MAX" --no-cpu-throttling --cpu 2 --memory 2Gi \
  --timeout 3600 --no-allow-unauthenticated --set-env-vars "OPENBLAH_ENV=$TARGET" \
  --set-secrets "$LK,DEEPGRAM_API_KEY=DEEPGRAM_API_KEY:latest,CARTESIA_API_KEY=CARTESIA_API_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest$extra"
WORKER_URL=$(gcloud run services describe "openblah-agent-$TARGET" --region "$REGION" --format='value(status.url)')

env_vars="OPENBLAH_STORAGE=firestore,AGENT_WORKER_URL=$WORKER_URL,AGENT_WORKER_AUTH=iam"
[ -n "${OPENBLAH_USER_MONTHLY_MINUTES:-}" ] && env_vars="$env_vars,OPENBLAH_USER_MONTHLY_MINUTES=$OPENBLAH_USER_MONTHLY_MINUTES"
[ -n "${OPENBLAH_DEFAULT_WHO_PAYS:-}" ] && env_vars="$env_vars,OPENBLAH_DEFAULT_WHO_PAYS=$OPENBLAH_DEFAULT_WHO_PAYS"
gcloud run deploy "openblah-server-$TARGET" --image "$REPO/server:$TAG" --region "$REGION" \
  --min-instances 0 --max-instances "$MAX" --allow-unauthenticated \
  --set-env-vars "$env_vars" \
  --set-secrets "$LK,OPENBLAH_API_KEYS=OPENBLAH_API_KEYS:latest$extra"

SA=$(gcloud run services describe "openblah-server-$TARGET" --region "$REGION" --format='value(spec.template.spec.serviceAccountName)')
gcloud run services add-iam-policy-binding "openblah-agent-$TARGET" --region "$REGION" \
  --member "serviceAccount:$SA" --role roles/run.invoker --quiet >/dev/null
URL=$(gcloud run services describe "openblah-server-$TARGET" --region "$REGION" --format='value(status.url)')
gcloud run services update "openblah-agent-$TARGET" --region "$REGION" \
  --update-env-vars "OPENBLAH_SERVER_URL=$URL" --quiet

curl -fsS "$URL/health" && echo
echo "Deployed. Server: $URL"
