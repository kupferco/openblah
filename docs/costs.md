# Costs and cost controls (T20)

Who pays for what, how the server limits spending, and the owner steps that no code can do.

## Per-minute cost model

```
cost/min ≈ LiveKit participant-minutes (humans + agent)
         + STT  (per audio minute, per human track)
         + TTS  (per character spoken)
         + LLM  (tokens in and out)
```

STT is billed per human track, so a 4-person call costs about 4x the STT of a 1:1 call even if
one person talks. **STT is VAD-gated**: audio only reaches the STT stream near detected speech (with a
short pre-roll and hangover), so silent tracks cost nothing (`packages/agent/src/group/vad-gate.ts`).
With the agent off, no audio goes to STT, LLM or TTS: a plain call costs only LiveKit minutes.
Target (not a fact): a 1:1 session near a few pence a minute, a 4-person call under about 10p a minute.

## Price table

Defaults in `packages/server/src/usage.ts` (`DEFAULT_PRICES`), in GBP. Override any field with
`OPENBLAH_PRICES` (JSON), for example `{"sttPerSecond":0.00012}`.

| Field                         | Default | Basis (checked 2026-11-17, **unverified**)                  |
| ----------------------------- | ------- | ----------------------------------------------------------- |
| `livekitPerParticipantMinute` | 0.0004  | LiveKit Cloud WebRTC minute, about $0.0005 beyond free tier |
| `sttPerSecond`                | 0.0001  | Deepgram streaming, about $0.0077 per audio minute          |
| `ttsPerCharacter`             | 0.00004 | Cartesia, about $0.00005 per character on a paid plan       |
| `llmInputPerMillionTokens`    | 0.24    | Gemini Flash, about $0.30 per million input tokens          |
| `llmOutputPerMillionTokens`   | 2.00    | Gemini Flash, about $2.50 per million output tokens         |

These are estimates from public price pages as I remember them. The coding session had no way to
open the live pricing pages, so **Dani must check each against the provider's page and update the
table and the date**. The usage log is an estimate, not a bill: the provider dashboards and the GCP
budget are the source of truth.

## What the server enforces

Defaults in `OPENBLAH_*` environment variables (see `.env.example`). `0` turns a limit off.

| Control                     | Setting                                                                                  | Effect                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Per-room max duration       | `OPENBLAH_MAX_ROOM_SECONDS` (7200); host may lower it per room with `maxDurationSeconds` | Agent stops when the session's wall-clock seconds reach it            |
| Idle timeout                | `OPENBLAH_IDLE_TIMEOUT_SECONDS` (300); per room `idleTimeoutSeconds`                     | Agent stops after that long with nobody speaking                      |
| Per-user monthly minutes    | `OPENBLAH_USER_MONTHLY_MINUTES` (off)                                                    | Minutes a user spent in rooms with the agent; needed for product keys |
| Per-host monthly minutes    | `OPENBLAH_HOST_MONTHLY_MINUTES` (off)                                                    | Minutes of agent audio in rooms the host owns                         |
| Monthly hosted-key cost cap | `OPENBLAH_MONTHLY_CAP_GBP` (50)                                                          | Stops the trial key and demo rooms at the cap (402 `trial_exhausted`) |
| 80% warning                 | automatic at 80% of the cap; optional `OPENBLAH_ALERT_WEBHOOK_URL`                       | Once a month: a JSON log line `{"event":"cost_alert",...}` and a POST |

How it works: the agent worker reports usage every 10 s (`POST /internal/rooms/:id/usage`). The
server adds it to the room's usage log and the monthly counters, and answers `available: false` with
a `stop` reason (`max_duration`, `idle_timeout`, `host_cap`, `user_cap`, `cost_cap`, `trial_used`)
when the agent must leave. New agents are refused at start with 429 and a `code` when a monthly
minute cap is reached. Months are UTC calendar months.

The **hosted** cost counter covers rooms paid by OpenBlah's own keys (trial and demo rooms). Rooms on
a host's own keys or a product key are logged but never stopped by the £50 cap, because the owner of
those keys pays. The counter is global across server instances (Firestore counters).

## Usage log

`GET /v1/rooms/:id/usage?actorUserId=<host>` (host only, read-only) returns LiveKit participant
minutes, agent seconds, STT audio seconds per track, TTS characters, LLM tokens in and out, the
estimated cost in GBP per provider with the price date, the room's effective limits, and the host's
minutes this month. The alert webhook receives `{ event, level: "warning_80" | "hard_cap", month,
hostedCostGbp, capGbp }`.

## Dani: owner steps

1. **GCP billing budget.** In GCP Billing create a budget of £50/month on the project with alerts at
   50%, 80% and 100% (£25 / £40 / £50). Check it with
   `scripts/check-gcp-budget.sh <project-id> [billing-account-id]`. It prints `budget ok`, or a
   `::viber-manual::` marker with the exact `gcloud billing budgets create ...` command. A budget alerts
   but does not stop spend by itself, which is why the server has its own cap.
2. **Provider spend limits** (done by Dani):
   - GCP spend caps are set on the OpenBlah project, for Cloud Run and the Gemini API.
   - Deepgram: auto-reload is off, so the prepaid balance is the limit.
   - Cartesia: on the free plan, so there is no overage.
   - OpenAI and ElevenLabs: no account exists, so no limit is needed. If either is added later, set a
     monthly budget (OpenAI: Settings, Limits; ElevenLabs: the usage-based billing cap) first.
3. **LiveKit free tier.** Open the LiveKit Cloud pricing page and compare it with this table, then tell
   the session if anything differs. Last known values (unverified, 2026-11-17): free "Build" plan with
   about 5,000 WebRTC participant minutes a month, a small number of concurrent participants (about
   100), and agent hosting limited to the free allowance; we host the worker on Cloud Run, not LiveKit.
4. Set `OPENBLAH_ALERT_WEBHOOK_URL` if you want the 80% alert somewhere other than the logs (for
   example a Slack incoming webhook), and optionally `OPENBLAH_USER_MONTHLY_MINUTES` for product-key
   deployments.

## Self-hosted LiveKit

With `LIVEKIT_MODE=self_hosted` the `livekitPerParticipantMinute` price no longer applies (the cost is a flat VM
plus egress); caps stay because of capacity. See [self-host-livekit.md](self-host-livekit.md).
