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
- `--timeout 3600`: the maximum request timeout (60 min). A call is an outbound connection to LiveKit, not an HTTP request, so Cloud Run would see a busy instance as idle and could stop it mid-call (it only allows 10 s after SIGTERM). To prevent that, each running job opens one long request to the worker's own `/hold` route through the service URL (`WORKER_SELF_URL`, set by the deploy; the worker's service account gets `roles/run.invoker` on itself). An open request keeps the instance from scaling down; it ends with the call. If the hold cannot be opened the worker logs `keepalive_failed` or `keepalive_rejected` and the call carries on unprotected.
- `--min-instances` comes from the repo variable `AGENT_MIN_INSTANCES` (default `0`, scale to zero). Set it to `1` to keep one instance warm: no cold start, but billed around the clock.
- `--max-instances 1` (`MAX_INSTANCES`), `--cpu 2 --memory 2Gi`: caps spend and fits the VAD and turn-detector models.
- Cost: CPU-always-allocated bills for the whole instance lifetime, not per request. At min 0 the instance is billed from start until Cloud Run stops it, about 15 min after the last request or call ends. At min 1 it is billed 24/7 (about 2 vCPU and 2 GiB, roughly 40-60 USD a month at europe-west1 instance-based rates; check the pricing page). Verify against the Cloud Run free tier in your project.

**Open point to verify in staging:** whether a dispatch created while no worker is registered is picked up once a worker registers (LiveKit retries pending dispatches for a short time). The server wakes the worker before dispatching to make this rare; if it fails in practice, the client should re-call `POST /v1/rooms/:id/agent` after a few seconds (it is idempotent).

## Owner checklist (first release and deploy)

Each part is separate. Do 1 for the npm packages, 2 for the servers, 3 to add a host app.

### 1. npm release (once)

1. On npmjs.com create the `openblah` organisation, so the `@openblah` scope is yours (free for public packages). If the name is taken, see the fallback below.
2. Create a granular access token (or an automation token) with read and write on the `@openblah` packages. Under Settings > Tokens.
3. In GitHub: Settings > Secrets and variables > Actions > New repository secret `NPM_TOKEN` = the token.
4. Actions > Release > Run workflow, tick **Dry run** first (it also runs in CI on every PR), then run it again without the tick. Or push a tag `v0.1.0`.
5. Check: `npm view @openblah/web version` prints `0.1.0` (same for `core`, `react-native`, `server`). The package page shows the provenance badge.

The first publish of a scoped package needs `--access public`; the workflow and each `publishConfig` already set it. Provenance needs the workflow's `id-token: write` (set) and a public repo.

**Fallback if the scope is blocked: GitHub Packages.** Change the package names to `@kupferco/...`, set `registry-url: https://npm.pkg.github.com` in `release.yml`, give the job `packages: write` and use `secrets.GITHUB_TOKEN` instead of `NPM_TOKEN`. Host apps then need an `.npmrc` with `@kupferco:registry=https://npm.pkg.github.com` and a token to install. Prefer npm; it needs no token to install.

### 2. Deploy server and agent (once)

1. Create (or pick) a GCP project with billing, then run the "One-time GCP setup" commands above (APIs, Firestore, Artifact Registry repo `openblah`, secrets).
2. Secrets in Secret Manager: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENBLAH_API_KEYS`, `DEEPGRAM_API_KEY`, `CARTESIA_API_KEY`, `GEMINI_API_KEY`. Optional, used if present: `OPENBLAH_PRODUCT_KEYS`, `OPENBLAH_AGENT_SECRET` (any long random string), `KEY_ENCRYPTION_SECRET`.
3. Create a deploy service account and give it `roles/run.admin`, `roles/artifactregistry.writer`, `roles/secretmanager.viewer` (so the workflow can see which optional secrets exist) and `roles/iam.serviceAccountUser`. The runtime account (the Compute default, unless you set another) needs `roles/datastore.user` and `roles/secretmanager.secretAccessor`.
4. Set up Workload Identity Federation for the GitHub repo `kupferco/openblah` ([guide](https://github.com/google-github-actions/auth#workload-identity-federation)), and allow it to impersonate the deploy account.
5. GitHub repo secrets: `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `OPENBLAH_SMOKE_API_KEY` (one of the keys in `OPENBLAH_API_KEYS`), `VIBER_URL`, `VIBER_HOOK_SECRET`. Optional repo variables: `GCP_REGION`, `MAX_INSTANCES` (default 1), `OPENBLAH_USER_MONTHLY_MINUTES`, `OPENBLAH_DEFAULT_WHO_PAYS`.
6. Push to `main` (or Actions > Deploy > Run workflow). Without GitHub Actions: `scripts/deploy.sh <project-id> prod`.
7. Check: `curl https://<server-url>/health` answers 200 (the URL is in the workflow log, or `gcloud run services describe openblah-server-prod --region europe-west1 --format='value(status.url)'`). The smoke test in the workflow also calls `/v1/warmup`.

LiveKit is self-hosted: follow [docs/self-host-livekit.md](self-host-livekit.md) first, and put its URL and key in the three `LIVEKIT_*` secrets.

Cost: both services scale to zero and are capped at 1 instance (`MAX_INSTANCES`), so at most one server and one agent run at a time. Raise the cap when one worker is not enough for your concurrent calls.

### 3. Register a host app (Housekeeper)

1. Make an API key for the app, for example `openssl rand -hex 24`, and add it to the comma-separated secret `OPENBLAH_API_KEYS` (new secret version). Housekeeper's backend keeps this key and calls `/v1/tokens` with it; it must never reach the browser.
2. Add its provider keys to the secret `OPENBLAH_PRODUCT_KEYS` (JSON, keyed by that API key):
   `{"<housekeeper api key>":{"gemini":"...","deepgram":"...","cartesia":"...","tier":"paid"}}`
3. Optional monthly cap per user: repo variable `OPENBLAH_USER_MONTHLY_MINUTES` (for example `120`; empty = off). The product can also set `userMonthlyMinutes` itself.
4. Choose who pays: for Housekeeper paying, call `PUT /v1/product/settings` with its API key and `{"settings":{"whoPays":"product"}}` (other values: `user_key`, `product_trial`). Or set the repo variable `OPENBLAH_DEFAULT_WHO_PAYS=product` for products that have not chosen. See [keys-and-trial.md](keys-and-trial.md).
5. Re-run the Deploy workflow so the new secret versions and variables are picked up (secrets are pinned at `latest` per revision).
6. Check: `curl -X POST https://<server-url>/v1/tokens -H "Authorization: Bearer <key>"` with a body answers 4xx about the body, not 401.

## Automated deploys

`.github/workflows/deploy.yml` builds both images, pushes them to Artifact Registry, deploys the worker then the server, smoke-tests `/health` and `/v1/warmup`, and sends the Viber deploy report (always). Every push to `main` deploys `prod`; by hand (Run workflow) you can choose `staging` or `prod`, and `prod` only from `main`. Both services use max instances 1 unless the repo variable `MAX_INSTANCES` says otherwise. `scripts/deploy.sh` does the same from your machine.

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

## Call history cleanup (T19)

Saved call history is deleted after each room's retention (30 days by default). A daily Cloud Scheduler job calls the protected cleanup endpoint with its own secret, `OPENBLAH_CLEANUP_SECRET` (not the agent secret):

```sh
gcloud secrets create OPENBLAH_CLEANUP_SECRET --replication-policy=automatic
openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add OPENBLAH_CLEANUP_SECRET --data-file=-
gcloud run services update openblah-server --region $REGION \
  --update-secrets OPENBLAH_CLEANUP_SECRET=OPENBLAH_CLEANUP_SECRET:latest
URL=$(gcloud run services describe openblah-server --region $REGION --format='value(status.url)')
gcloud scheduler jobs create http openblah-history-cleanup --location=$REGION \
  --schedule="17 3 * * *" --time-zone=UTC --http-method=POST \
  --uri="$URL/internal/history/cleanup" \
  --headers="Authorization=Bearer $(gcloud secrets versions access latest --secret=OPENBLAH_CLEANUP_SECRET)"
```

Verify: `gcloud scheduler jobs run openblah-history-cleanup --location=$REGION`, then the server log shows a 200 for `/internal/history/cleanup`. `scripts/check-history-cleanup.sh` checks that the job exists and prints a `::viber-manual::` marker with these commands if not.

Endpoints (all but the guest one need the API key and `actorUserId`): `GET /v1/history`, `GET /v1/history/:roomId`, `DELETE /v1/history/:roomId` (host), `PUT /v1/rooms/:id/history-settings` (host; `saveNotes`, `retention` of `30d`, `1y` or `forever`), `GET /v1/invites/:token/history` (guest, read-only, 30 days, Q3), and for the agent worker `POST /internal/rooms/:id/history`.

**Reading the timing logs** (Cloud Run logs, JSON lines): `turn_latency` per reply (`transcriptionDelayMs`, `endOfTurnDelayMs`, `llmFirstTokenMs`, `ttsFirstByteMs`, `endOfSpeechToFirstAudioMs`), `tool_call` per tool (`tool`, `durationMs`, `ok`) and `cold_start` per call (`processUptimeMs`, `sessionReadyMs`, `firstJob`). Replies are spoken sentence by sentence: Cartesia's streaming TTS gets the LLM text through a sentence tokenizer, so audio starts after the first sentence, not the whole reply.
