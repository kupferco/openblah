# Plan: Who pays switch for products

- Task: #370
- Title: Who pays switch for products
- Date: 2026-11-20
- Link: https://viber-f7sxvx63aq-nw.a.run.app/?task=370

## Summary

docs/plan.md 4.1 said "the embedding product pays". That is now too rigid: OpenBlah and its products are free and open source, so the owner cannot pay for everyone's agent usage. Each embedded product gets a **who-pays mode** that its owner can change at any time. This plan only designs it; no app code changes here. docs/plan.md 4.1 and 6 are updated with the decision.

## What exists today

- docs/keys-and-trial.md: the server picks a mode per room in order BYOK (host's saved key), product key (`OPENBLAH_PRODUCT_KEYS`, per API key), then trial (hosted key, 300 s per signed-in account). Errors: `409 no_key`, `401 sign_in_required`, `402 trial_exhausted`.
- docs/costs.md: per-user monthly minutes (`OPENBLAH_USER_MONTHLY_MINUTES`, off by default), stop reasons including `user_cap`, and the £50 hosted-key cap.
- docs/model-settings.md: settings at room, user/product and server levels, `PUT /v1/product/settings`, and the settings MCP tool (`get_settings`, `propose_settings_change`, `confirm_settings_change`).
- Key storage (AES-256-GCM, per owner and provider) and `GET /v1/rooms/:id/key-mode` exist already.

So modes 1 and 2 mostly exist; what is missing is that the product, not the server's fixed order, chooses the mode, and the user-facing and owner-facing parts.

## The three modes

Stored as a product setting `whoPays`: `product` | `user_key` | `product_trial` (default for a new product: `user_key`, see Q1). It sits in the product settings level next to the model, so it is read and changed through `PUT /v1/product/settings`, the settings screen, and the settings MCP tool. Changing it by MCP follows the existing propose/confirm rule, and only the product owner (product API key) may do it, never an end user.

1. **`product`**: the product's key pays for everyone. Per-user minute caps stay and should be on (chunk 15); the owner sets the cap in the same screen. Good for early testing.
2. **`user_key`**: on first voice start the user is asked to add their own key. The sheet offers Gemini first (suggested: free key, with the free-tier data warning and the "never for private data" rule, and refused in `sensitive` rooms), then OpenAI and Claude. Saved via the existing `saveKey`/`/v1/me/keys`, used only for rooms that user hosts. The product's key is never used.
3. **`product_trial`**: the product's key pays up to a per-user allowance (default 5 minutes, product-configurable, counted in seconds of agent audio like the OpenBlah trial), then the user is asked for their own key. Needs a per-user, per-product usage counter (the OpenBlah trial counter is per account and global; this one is per product).

Resolution order per room becomes: the product's `whoPays` decides which of {user's key, product key} is tried; the OpenBlah hosted trial applies only to standalone-app users (no product). Self-hosted servers behave as `product`.

## Safe switch from 1 to 2

- A new error `402 key_required` (with `reason: "product_not_paying" | "trial_used"` and the product's name) replaces `409 no_key` for product users. The SDKs map it to a typed event, and the ready component shows a plain message: "Add your own key to keep using voice", with the add-key sheet one tap away. Never a silent failure, never a generic error.
- Existing live calls are not cut when the owner switches; the change applies at the next voice start. (Q4.)
- Text chat and non-voice parts of the product are unaffected.
- Switching back to `product` is instant; saved user keys stay stored and are simply not used (the user can delete them).
- Owner visibility on the settings screen: current mode, number of users with their own key (count only, never keys, excluding `is_test` users), number of users who hit `key_required` in the last 30 days, and minutes used on the product key. The settings MCP tool returns the same counts in `get_settings`.
- The embedding product's own UI can pre-check with a new `GET /v1/users/:userId/key-status` (`ok | needs_key`) to show the banner before the user taps.

## Docs to add or change

- docs/host-integration.md: the three modes, how to switch, what users see.
- docs/keys-and-trial.md: new resolution order, `key_required`, trial allowance.
- A user-facing line in the add-key sheet and docs: consumer subscriptions (ChatGPT Plus, Claude app, Gemini app) cannot power another app, so an API key is needed (a free Gemini key is the easy start).
- docs/costs.md: LiveKit note below. docs/integrations/housekeeper.md: pick the mode.

## LiveKit minutes

LiveKit stays on the OpenBlah server's LiveKit account in every mode: users and products never hold LiveKit keys, and a user's own LLM key does not pay for call minutes. The free plan is the limit, so this is the real remaining cost to the owner. A cap is needed too, and it should be per product, not just global: `OPENBLAH_PRODUCT_LIVEKIT_MINUTES` monthly (participant minutes), with the existing per-room max duration and idle timeout. A product over its cap gets `402 livekit_cap` and a message; a global ceiling stops everything before the LiveKit plan is exceeded, with an 80% alert like the £50 cap. Plain calls with the agent off cost only LiveKit minutes, so the cap applies to them as well. Exact allowances need checking on LiveKit's pricing page (still a **Verify** in plan section 6).

## Self-hosting LiveKit (owner addition, not urgent)

Until then, stay on the LiveKit Cloud free tier. The goal is a flat monthly cost for audio instead of per minute. Numbers below are starting points and need checking against LiveKit's self-hosting docs and the VM provider's pricing (**Verify**).

- **Where it runs.** LiveKit cannot run on Cloud Run: WebRTC media needs UDP and a stable public IP. Owner decision (2026-11-20): it goes on one small Google Compute Engine VM, keeping everything on GCP, not a VPS such as Hostinger. Region: `europe-west2` (London), near the owner and first testers; `southamerica-east1` (São Paulo) is noted for later, as a second VM only if Brazilian users see latency (clients would then need to pick the nearest URL, a later change). The OpenBlah server and agent worker stay on Cloud Run and only point at it through `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.
- **VM size for 2-4 person calls.** Audio only, no video, no egress or ingress service: media is about 30-50 kbps per stream, so bandwidth and CPU are small. Start with 2 vCPU and 4 GB RAM (GCE `e2-medium`; `e2-small` is enough for a handful of testers), Ubuntu LTS, one static IP, and move to 4 vCPU if CPU stays above about 50% in monitoring. A single node needs no Redis. Expect roughly tens of concurrent rooms on this size (**Verify** with a load test using `lk load-test`).
- **Cost estimate (GCE, handful of testers).** Rough on-demand prices, to **Verify** in the GCP pricing calculator for the exact region:
  - VM `e2-medium` in London: about $0.04/hour, roughly $29-30/month running 24/7 (a 1-year commitment lowers it; `e2-small` is about half). 20 GB standard boot disk about $1; static external IP about $3/month. Fixed part: about $33/month ($18 with `e2-small`).
  - Network egress to the internet (Premium tier) is about $0.12/GB, with a small free allowance. Audio is about 40 kbps per stream, so one participant listening to one other stream uses about 20 MB per hour. A handful of testers (5 people, about 1 hour a day each, with the agent as an extra stream) is about 150-300 participant-hours a month, so about 3-6 GB, which is under $1. Even ten times that is about $7. Ingress is free. Media between the VM and the Cloud Run agent worker is also internet traffic and is counted in the same estimate (the agent's stream is small).
  - Expected total: about $35 a month for a handful of testers, or about $20 with `e2-small`, plus under $1-7 of egress. Compare with LiveKit Cloud's free tier, which costs nothing until its limits: self-hosting only pays off once usage passes the free tier, so keep Cloud until then. São Paulo prices are higher (VM about 40-60% more, egress about $0.12-0.19/GB), which is another reason to stay London-only at first.
  - Add a GCP budget alert on the VM project (the existing £50 budget covers it) and set the VM so it can be stopped when not testing (a stopped VM costs only the disk and IP).
- **Ports and firewall.** Open only: `443/tcp` (HTTPS and WebSocket signalling through the reverse proxy, and TURN over TLS), `80/tcp` (certificate issuing), `7881/tcp` (WebRTC over TCP fallback), `3478/udp` (TURN/UDP), and the media UDP range (default `50000-60000/udp`; a single port such as `7882/udp` with `udp_port` is simpler to firewall and enough at this size). Keep `7880` (LiveKit's own HTTP port) closed to the internet and reachable only by the proxy on the same host. SSH only from the owner's IP or through the provider's console. On GCE this is a VPC firewall rule with a network tag; SSH through IAP rather than an open port 22.
- **TLS and domain.** A subdomain such as `rtc.<domain>` with an A record to the static IP, and a second name for TURN if the TLS-TURN setup needs it (`turn.<domain>`). Use LiveKit's generated Docker Compose setup, which runs Caddy for automatic Let's Encrypt certificates. Clients and the server use `wss://rtc.<domain>` as `LIVEKIT_URL`.
- **TURN.** Turn on LiveKit's built-in TURN server (`turn.enabled`, TLS on 443 and UDP on 3478) so people behind strict networks (corporate, some mobile carriers) still connect. No separate coturn is needed at this size. Set the node's `rtc.use_external_ip: true` so it advertises the public IP. Test from a phone on mobile data and from a network that blocks UDP.
- **Agent worker connection.** The worker is a LiveKit Agents process that connects outbound over `wss://` to the self-hosted server using the same API key and secret as the OpenBlah server, so no inbound port is needed on Cloud Run. The scale-to-zero caveat in plan section 3 stays: the OpenBlah server dispatches the worker on demand. The worker joins as a normal participant and counts in the participant totals. LiveKit Cloud-only features (built-in inference, hosted agents, Cloud analytics) are not available, which is fine because the agent uses our own `LlmProvider` and STT/TTS adapters.
- **Monitoring.** An external uptime check (Google Cloud Monitoring uptime check or a free uptime service) against `https://rtc.<domain>` with an alert to the owner; LiveKit's Prometheus endpoint (`prometheus_port`, bound to localhost) scraped by Grafana Cloud free or Google Managed Prometheus for rooms, participants, CPU and bandwidth; VM CPU, disk and network alerts; certificate expiry alert; a small synthetic check that creates a room and joins it once an hour. Backups are not needed (rooms are ephemeral), but keep the `livekit.yaml` and compose file in a private repo or secret store. Use unattended security updates and pin the LiveKit image version, with a tested upgrade routine.
- **Switch between Cloud and self-hosted.** One server-level setting: `LIVEKIT_URL` plus the key and secret, nothing else changes. Add `LIVEKIT_MODE` (`cloud` | `self_hosted`, default `cloud`) only for behaviour that differs: the minute caps, cost estimates in `docs/costs.md` and the health page. Rooms already running stay on the server they started on (room records store which LiveKit URL created them); the change applies to new rooms. Clients take the URL from the token response, so SDKs and products need no change. Roll back by setting the three variables back, so keep the Cloud project alive until self-hosting has run for a month. The server health check also reports which LiveKit it uses and whether it is reachable.
- **Who pays and caps.** Users never need their own LiveKit key. Per-user audio minute caps and the per-product LiveKit caps stay on the hosted OpenBlah server, even when self-hosted, because the VM has a finite capacity (concurrent rooms and bandwidth) and a runaway product could starve others; the cap's reason shifts from the plan's price to capacity. Self-hosters of OpenBlah bring their own LiveKit (Cloud or their own VM), with the same env variables, and set their own caps or none.
- **Not in scope now.** No code change in this task. Do it after the free tier shows real usage; a task below covers the work.

## Risks

- Self-hosted LiveKit makes the owner responsible for uptime, patching and security of a public server; a single VM is a single point of failure for all calls (mitigation: keep the Cloud project as a fallback via the switch).
- Friction: forcing a key on first use will lose many users; mode 3 and the free Gemini suggestion soften it.
- Free-tier Gemini data may be used by Google: sensitive products (TeraPay) must use paid keys; `user_key` with `sensitive` rooms needs the paid-tier confirmation already in the key flow.
- Users are not technical; the sheet needs plain steps and a link straight to the key page.
- Overlap: no other open planning task's plan exists on main or the other branches (checked all `docs/plans` paths on origin). The standalone app tasks (T24 onward, docs/app.md) already have an onboarding "add own key / start trial" step; this plan reuses it for product users and does not change it (see Q5).

## Open questions

### Q1. What should be the default who-pays mode for a newly registered product?

Context: it decides whether a new product costs the owner anything until someone changes the setting.
Assumed: `user_key` for new products, while Housekeeper is explicitly set to `product` for early testing.
Type: business
Answer: _open_

### Q2. How big should the default trial allowance be in `product_trial` mode?

Context: too small and users churn at the key prompt; too big and the product owner pays more.
Assumed: 5 minutes of agent audio per user, configurable per product.
Type: business
Answer: _open_

### Q3. Should the per-user minute cap be mandatory when the mode is `product`?

Context: without it one user can run up the product owner's bill.
Assumed: Yes, a default of 60 minutes per user per month that the owner can raise or turn off.
Type: business
Answer: _open_

### Q4. When the owner switches 1 to 2, may calls already in progress finish?

Context: cutting a call mid-sentence is bad; letting it run costs a little more.
Assumed: Yes, running calls finish (up to the room max duration); the change applies to the next voice start.
Type: technical
Answer: _open_

### Q5. Should the add-your-own-key sheet be the same one the standalone app uses?

Context: the standalone app (T16/T24) already plans an onboarding step for keys; one shared component avoids two flows.
Assumed: Yes, one shared component in the SDK, themable by the product.
Type: technical
Answer: _open_

### Q6. What LiveKit cap should each product get by default?

Context: LiveKit minutes always land on the owner's account, so a runaway product could use up the free plan.
Assumed: A global ceiling at about 80% of the free plan and a per-product monthly cap of 500 participant minutes, both env settings, until the real plan limits are checked.
Type: business
Answer: _open_

### Q7. Should users with their own key be able to use it across several products?

Context: a key saved once is convenient, but ties users together across products and widens the blast radius of a leak.
Assumed: No, keys stay per product and user for now; the standalone app account is separate.
Type: business
Answer: _open_

### Q8. Should a product owner see which users have their own key, or only the count?

Context: names are personal data (UK GDPR / LGPD); a count is enough for the decision to switch.
Assumed: Count only.
Type: business
Answer: _open_

### Q9. Which VM provider should host the self-hosted LiveKit?

Context: it decides whether the monthly cost is flat (egress on GCE is metered) and where the owner already has an account.
Assumed: Google Compute Engine in `europe-west2` (London), São Paulo later only if latency needs it.
Type: business
Answer: GCE, London first, São Paulo later (owner decision 2026-11-20).

### Q10. When should the move off LiveKit Cloud happen?

Context: self-hosting adds work and risk; it pays off only above the free plan.
Assumed: Only when the free tier is about 70% used for two months, or a product needs more than its limits; not before.
Type: business
Answer: _open_

## Suggested tasks

1. Who-pays setting and resolution: `whoPays` product setting (`product`, `user_key`, `product_trial`), new key resolution order, `key_required` error, tests that each mode and the switch behave.
2. Per-product trial allowance (after 1): per-user, per-product seconds counter and the configurable allowance.
3. Owner settings screen and settings MCP tool (after 1): switch the mode, caps, and counts (own-key users, `key_required` hits, usage), `is_test` excluded.
4. Add-your-own-key sheet in the SDKs and `key_required` handling (after 1): Gemini-first with free-tier warning, OpenAI and Claude, plain "add your own key to keep using voice" message, `key-status` pre-check.
5. LiveKit minute caps (after 1): per-product and global caps, alert, `livekit_cap` error and message.
6. Docs (after 3): host-integration, keys-and-trial, costs, Housekeeper guide, consumer-subscription note.
7. Self-hosted LiveKit runbook and switch (not urgent, after 5): `docs/self-host-livekit.md` with the VM, firewall, TLS, TURN and monitoring steps and a compose/`livekit.yaml` template, `LIVEKIT_MODE` and the room record's LiveKit URL, health check reporting, and a test of the switch. Owner steps (create the VM, DNS, secrets) use the manual marker.
