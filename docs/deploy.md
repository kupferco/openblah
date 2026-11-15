# Deploying the server to Cloud Run

`packages/server` is a Hono service. It is built from the repo root with `packages/server/Dockerfile`.

## Run locally

```sh
cp .env.example .env   # fill in LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, OPENBLAH_API_KEYS
pnpm install
pnpm --filter @openblah/server dev
curl localhost:8080/health
```

Or with Docker: `docker build -f packages/server/Dockerfile -t openblah-server .` then
`docker run --rm -p 8080:8080 --env-file .env openblah-server`.

API (all `/v1` calls need `Authorization: Bearer <one of OPENBLAH_API_KEYS>`):

| Call                | Body                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `GET /health`       | none, no auth                                                                               |
| `POST /v1/rooms`    | `hostUserId`, `hostDisplayName`, optional `agent` (`on\|off\|ask`), `sensitive`, `metadata` |
| `GET /v1/rooms/:id` | none                                                                                        |
| `POST /v1/tokens`   | `roomId`, `userId`, `displayName`; returns a 10-minute LiveKit join token                   |

## One-time GCP setup

```sh
PROJECT=your-gcp-project
REGION=europe-west1
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com firestore.googleapis.com cloudbuild.googleapis.com
gcloud firestore databases create --location=$REGION   # skip if one exists
gcloud artifacts repositories create openblah --repository-format=docker --location=$REGION

# Secrets (paste each value when prompted)
for s in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET OPENBLAH_API_KEYS; do
  gcloud secrets create $s --replication-policy=automatic
  printf "value for $s: "; read -rs v; echo; printf %s "$v" | gcloud secrets versions add $s --data-file=-
done
```

The Cloud Run service account needs `roles/datastore.user` (Firestore) and
`roles/secretmanager.secretAccessor`.

## Build and deploy

```sh
IMAGE=$REGION-docker.pkg.dev/$PROJECT/openblah/server:latest
gcloud builds submit --config - . <<EOF2
steps:
  - name: gcr.io/cloud-builders/docker
    args: ["build", "-f", "packages/server/Dockerfile", "-t", "$IMAGE", "."]
images: ["$IMAGE"]
EOF2

gcloud run deploy openblah-server --image $IMAGE --region $REGION \
  --allow-unauthenticated --min-instances 0 \
  --set-env-vars OPENBLAH_STORAGE=firestore \
  --set-secrets LIVEKIT_URL=LIVEKIT_URL:latest,LIVEKIT_API_KEY=LIVEKIT_API_KEY:latest,LIVEKIT_API_SECRET=LIVEKIT_API_SECRET:latest,OPENBLAH_API_KEYS=OPENBLAH_API_KEYS:latest
```

`--allow-unauthenticated` is fine because the app checks the API key itself. Automated deploys are wired up in T5.
