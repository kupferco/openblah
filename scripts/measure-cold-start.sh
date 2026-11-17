#!/usr/bin/env bash
# Measure Cloud Run cold start of the agent worker: scale it to zero, then time the first request.
# Usage: scripts/measure-cold-start.sh <worker-service> <region> [runs]
# Needs gcloud logged in with access to the project (owner/deploy account).
set -euo pipefail
svc="${1:?service name}"; region="${2:?region}"; runs="${3:-5}"
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' | grep -q .; then
  echo '::viber-manual::{"reason":"gcloud is not logged in","action":"Log in with an account that can read and update the Cloud Run worker service","commands":["gcloud auth login","gcloud config set project <id>"],"verify":"gcloud run services list --region <region> shows the worker"}'
  exit 1
fi
url=$(gcloud run services describe "$svc" --region "$region" --format='value(status.url)')
token=$(gcloud auth print-identity-token)
for i in $(seq "$runs"); do
  # A new revision (unique env var) has no running instance, so the next request is a cold start.
  gcloud run services update "$svc" --region "$region" --update-env-vars "COLD_START_RUN=$i-$(date +%s)" --quiet >/dev/null
  t=$(curl -s -o /dev/null -w '%{time_total}' -H "Authorization: Bearer $token" "$url/")
  echo "run $i: first request ${t}s"
done
