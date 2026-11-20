# Self-hosting LiveKit

Not urgent. Stay on LiveKit Cloud's free tier until it is about 70% used for two months, or a product
needs more than its limits. Then move to one small Google Compute Engine (GCE) VM. Cloud Run cannot
host LiveKit: WebRTC media needs UDP and a stable public IP.

Prices and sizes below are starting points. **Verify** them in the GCP pricing calculator and LiveKit's
self-hosting docs before you commit.

## What changes in OpenBlah

Nothing in the SDKs or products. The server reads three variables and one mode:

| Variable                          | Meaning                                                          |
| --------------------------------- | ---------------------------------------------------------------- |
| `LIVEKIT_URL`                     | `wss://rtc.<domain>` (self-hosted) or your LiveKit Cloud URL     |
| `LIVEKIT_API_KEY` / `_API_SECRET` | The key pair from `livekit.yaml` (or the Cloud project)          |
| `LIVEKIT_MODE`                    | `cloud` (default) or `self_hosted`. Anything else fails at start |

- Each room record stores the `livekitUrl` it was created on. Token responses (`/v1/tokens`, guest join,
  `/v1/me/calls`) return that URL, so clients connect to the right server.
- The switch applies to **new rooms**. Rooms already running keep their old URL. Their tokens are still
  signed with the new key pair, so a room that outlives the switch can only be joined again if both
  servers share the key pair. Easiest: switch when no calls are running (rooms end at the max duration,
  default in `docs/costs.md`), and keep the Cloud project alive.
- `GET /health` (no key) answers `{"ok":true,"livekit":{"mode","host","reachable"}}`. `reachable` is
  `false` when LiveKit does not answer within 3 s; the endpoint still returns 200 so the server is not
  restarted for LiveKit's outage. Alert on `livekit.reachable == false`. Only the host is shown.
- **Roll back:** set the three variables and `LIVEKIT_MODE=cloud` back and redeploy. Keep the Cloud
  project for a month after the move.
- Per-user and per-product minute caps stay on the OpenBlah server, because the VM has finite capacity.
  The agent worker connects outbound over `wss://` with the same key pair; no inbound port on Cloud Run.

## Owner steps

These need the owner's cloud account and DNS. The Viber manual marker for them:

```
::viber-manual::{"reason":"Self-hosting LiveKit needs a GCE VM, DNS and secrets only the owner can create","action":"Follow docs/self-host-livekit.md steps 1-4 on branch feat/self-hosted-livekit-runbook-and-switch-n (or main once merged)","commands":["gcloud auth login","gcloud config set project <id>"],"verify":"curl -s https://<server>/health shows livekit.mode self_hosted and reachable true"}
```

### 1. VM and static IP (London first)

```sh
gcloud compute addresses create livekit-ip --region=europe-west2
gcloud compute instances create livekit \
  --zone=europe-west2-a --machine-type=e2-medium \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB --tags=livekit --address=livekit-ip
```

`e2-medium` (2 vCPU, 4 GB) is about $33/month fixed; `e2-small` is enough for a few testers. Audio only,
about 40 kbps per stream, so egress is a few GB a month. A stopped VM costs only the disk and IP. Move to
4 vCPU if CPU stays above about 50%. São Paulo (`southamerica-east1`) is later, only for latency, and
costs more.

### 2. Firewall

```sh
gcloud compute firewall-rules create livekit-public --target-tags=livekit \
  --allow=tcp:80,tcp:443,tcp:7881,udp:3478,udp:7882
gcloud compute firewall-rules create livekit-ssh-iap --target-tags=livekit \
  --allow=tcp:22 --source-ranges=35.235.240.0/20   # SSH only through IAP
```

Do not open `7880` (LiveKit's own HTTP port): only Caddy on the same host reaches it.

### 3. DNS and TLS

Create an A record `rtc.<domain>` and a second `turn.<domain>` to the static IP. Caddy gets the
Let's Encrypt certificates when the stack below starts (port 80 must be open).

### 4. Secrets

Generate a key pair on the VM (`docker run --rm livekit/livekit-server generate-keys`). Store it in
Secret Manager as `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, and put the URL in `LIVEKIT_URL`. Never commit them.

## Templates

Keep these files in a private repo or secret store. Pin the image version (check the current release).

`livekit.yaml`:

```yaml
port: 7880
log_level: info
rtc:
  tcp_port: 7881
  udp_port: 7882 # one media port: simple to firewall, enough at this size
  use_external_ip: true
turn:
  enabled: true
  domain: turn.<domain>
  tls_port: 5349 # reached on 443 through Caddy's layer4 or a separate LB; or keep 5349 open if you prefer
  udp_port: 3478
  external_tls: true
keys:
  <API_KEY>: <API_SECRET>
prometheus_port: 6789 # bound to localhost by the firewall: do not open it
```

`docker-compose.yaml`:

```yaml
services:
  livekit:
    image: livekit/livekit-server:v1.8.0 # pin and test upgrades
    command: --config /etc/livekit.yaml
    network_mode: host
    restart: unless-stopped
    volumes: ["./livekit.yaml:/etc/livekit.yaml:ro"]
  caddy:
    image: caddy:2
    network_mode: host
    restart: unless-stopped
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro", "caddy_data:/data"]
volumes:
  caddy_data:
```

`Caddyfile`:

```
rtc.<domain> {
  reverse_proxy localhost:7880
}
```

LiveKit's generated setup (`docker run --rm -it -v$PWD:/output livekit/generate`) produces a
tested variant of all three with Caddy and TURN-over-TLS on 443. Prefer it if the above does not
fit; treat the TURN block as the part to **Verify**. Turn on unattended security updates on the VM.

## Check it

1. `curl -s https://rtc.<domain>` answers `OK`.
2. Load test: `lk load-test --url wss://rtc.<domain> --api-key <k> --api-secret <s> --room test --audio-publishers 4 --subscribers 4 --duration 1m`.
3. Join from a phone on mobile data and from a network that blocks UDP: TURN must connect.
4. Set `LIVEKIT_MODE=self_hosted` and the new URL on the server, redeploy, then check `/health`.
   Start a call and confirm the token response `livekitUrl` is `wss://rtc.<domain>`.

## Monitoring

- Uptime check on `https://rtc.<domain>` and on the OpenBlah `/health` (alert when
  `livekit.reachable` is false), with an alert to the owner.
- VM CPU, disk and network alerts; certificate expiry alert; the existing GCP budget alert covers the VM.
- Prometheus (`prometheus_port`, localhost only) scraped by Grafana Cloud free or Google Managed
  Prometheus: rooms, participants, CPU, bandwidth.
- An hourly synthetic check that creates a room and joins it.
- Rooms are ephemeral, so no backups; a single VM is a single point of failure, so keep the Cloud
  project as the fallback via the switch.
