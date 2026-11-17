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

| Call                       | Body                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `GET /health`              | none, no auth                                                                               |
| `POST /v1/rooms`           | `hostUserId`, `hostDisplayName`, optional `agent` (`on\|off\|ask`), `sensitive`, `metadata` |
| `GET /v1/rooms/:id`        | none                                                                                        |
| `POST /v1/tokens`          | `roomId`, `userId`, `displayName`; returns a 10-minute LiveKit join token                   |
| `POST /v1/warmup`          | `userId`; wakes the agent worker only. 6 calls per user per minute, then 429                |
| `POST /v1/rooms/:id/agent` | none; wakes the worker, then dispatches the agent into the room                             |

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

`--allow-unauthenticated` is fine because the app checks the API key itself.

## Scale-to-zero design (T5)

Two Cloud Run services, both min instances 0: `openblah-server-<env>` (public, checks the API key itself) and `openblah-agent-<env>` (the LiveKit Agents worker, private: only the server's service account has `roles/run.invoker`).

**The problem.** A LiveKit Agents worker opens a WebSocket to LiveKit, registers, and waits for jobs. With zero instances nothing is registered, so no job can be assigned.

**The choice: wake by request, then explicit dispatch.** We keep the standard worker (registered under the dispatch name `openblah-agent`) and make the server start it:

1. The client calls `POST /v1/warmup` when it opens and when the page becomes visible again (`startWarmup` in `@openblah/web`). The server sends one `GET` to the worker's URL (its built-in HTTP server listens on `$PORT`). Cloud Run starts an instance; the worker registers with LiveKit. No STT, LLM or TTS call is made. Warm-up is idempotent: the server coalesces wakes within 10 s, and rate-limits each user (6 per minute, in memory per instance).
2. When the user taps to talk, `POST /v1/rooms/:id/agent` wakes the worker again (cheap if it is already up) and creates an explicit LiveKit dispatch. Dispatch is idempotent per room.
3. If the worker is still cold, the client already shows "connecting" and the call works as a plain room (`agentState` is `unavailable`) until the agent joins.

We rejected a pure "explicit dispatch API starts a Cloud Run job per call" design: the Agents framework needs its registered-worker loop, and a job per call would pay the full image start on every tap, with no warm-up benefit.

**Cloud Run settings for the worker** (set in `.github/workflows/deploy.yml`):

- `--no-cpu-throttling` (CPU always allocated): the worker's LiveKit WebSocket and audio processing are not tied to an HTTP request, and throttled CPU between requests would stall them.
- `--timeout 3600`: the maximum request timeout (60 min). Our health request is short, but the instance stays up while calls run because LiveKit keeps the worker busy; it is kept alive by that load plus Cloud Run's idle period (up to about 15 min after the last request). Calls longer than an hour are fine, since the job is not a request. If you see instances stopped mid-call, set `--min-instances 1` during the call window or raise the idle keep-alive by warming up more often.
- `--max-instances 5`, `--cpu 2 --memory 2Gi`: caps spend and fits the VAD and turn-detector models.
- Cost: CPU-always-allocated bills for the whole instance lifetime, not per request. At min 0 the instance is idle-billed only for about 15 min after the last warm-up. Verify against the Cloud Run free tier in your project.

**Open point to verify in staging:** whether a dispatch created while no worker is registered is picked up once a worker registers (LiveKit retries pending dispatches for a short time). The server wakes the worker before dispatching to make this rare; if it fails in practice, the client should re-call `POST /v1/rooms/:id/agent` after a few seconds (it is idempotent).

## Automated deploys

`.github/workflows/deploy.yml` builds both images, pushes them to Artifact Registry, deploys the worker then the server, smoke-tests `/health` and `/v1/warmup`, and sends the Viber deploy report (always). Staging deploys on every push to the `staging` branch; production only by hand (Run workflow, env `prod`) and only from `main`.

Repo secrets needed:

| Secret                           | What                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`                 | GCP project id                                                                              |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Workload identity provider resource name (or switch the auth step to a key in `GCP_SA_KEY`) |
| `GCP_SERVICE_ACCOUNT`            | Deploy service account email                                                                |
| `OPENBLAH_SMOKE_API_KEY`         | One of `OPENBLAH_API_KEYS`, for the warm-up smoke test                                      |
| `VIBER_URL`, `VIBER_HOOK_SECRET` | Viber deploy report                                                                         |

The runtime secrets (`LIVEKIT_*`, `OPENBLAH_API_KEYS`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `GEMINI_API_KEY`) live in Secret Manager (create them as in the setup above). Optional repo variable `GCP_REGION` (default `europe-west1`). Staging and prod use separate services in the same project (`-staging`, `-prod`); use separate Secret Manager secrets or projects if you want separate LiveKit projects.

The deploy service account needs: `roles/run.admin`, `roles/artifactregistry.writer`, `roles/iam.serviceAccountUser` on the runtime service account, and `roles/secretmanager.secretAccessor` for the runtime account. The runtime account also needs `roles/datastore.user`. If a secret is missing the workflow prints a `::viber-manual::` line.

## Cold start of the worker image

Target: under about 3 s from first request to a registered worker.

Image choices to keep it small and fast: production-only dependencies (`pnpm deploy --prod`), a slim glibc base (alpine cannot run the native LiveKit modules), models baked in with `download-files` at build time so nothing downloads on start, and the worker preloads VAD and the turn detector in `prewarm`.

**Measured: not yet.** This session could not deploy or run Docker. After the first staging deploy run:

```sh
scripts/measure-cold-start.sh openblah-agent-staging europe-west1 5
```

It creates a fresh revision each run and times the first request (container start plus the worker's HTTP server answering). Record the median here, and the time from request to "registered" in the worker logs:

| Date | Image size | Median first-request time | Notes |
| ---- | ---------- | ------------------------- | ----- |
| TBD  | TBD        | TBD                       |       |
