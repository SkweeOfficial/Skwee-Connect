# Uptime monitoring with UptimeRobot

SKWEE Connect exposes a public health endpoint that uptime monitors
can poll. This guide wires it up to [UptimeRobot](https://uptimerobot.com)
(the free plan is enough: 50 monitors at 5-minute intervals).

## The health endpoint

| Request                  | Checks                                                                      | Healthy | Unhealthy         |
| ------------------------ | --------------------------------------------------------------------------- | ------- | ----------------- |
| `GET /api/health`        | The Next.js server is serving requests                                      | `200`   | no answer / `5xx` |
| `GET /api/health?deep=1` | The above, plus Supabase Auth is reachable (`/auth/v1/health`, 5 s timeout) | `200`   | `503`             |

Both return JSON with `Cache-Control: no-store`, and both answer `HEAD`
requests too. Example deep response:

```json
{
  "status": "ok",
  "time": "2026-09-23T12:00:00.000Z",
  "checks": { "supabase": { "status": "ok", "latencyMs": 84 } }
}
```

The endpoint needs no auth and bypasses the session middleware, so it
works regardless of login state. It reveals only up/down and upstream
latency.

Check it before setting up the monitor:

```bash
curl -i https://crm.example.com/api/health?deep=1
```

## Setting up UptimeRobot

1. Sign in at <https://dashboard.uptimerobot.com> and click
   **New monitor**.
2. **App monitor** (is the site up?):
   - Monitor type: **HTTP(s)**
   - URL: `https://<your-domain>/api/health`
   - Friendly name: `SKWEE Connect – app`
   - Monitoring interval: 5 minutes
3. Add a second monitor, **Backend monitor** (can the app reach
   Supabase?):
   - Monitor type: **HTTP(s)**
   - URL: `https://<your-domain>/api/health?deep=1`
   - Friendly name: `SKWEE Connect – Supabase`
   - Optionally, under **Advanced settings**, switch to **Keyword**
     monitoring and alert when the keyword `"status":"ok"` does _not_
     exist. This is unnecessary with plain HTTP(s) monitoring because
     the endpoint already returns `503` when degraded.
4. Under **Integrations & Team**, attach alert contacts (email is on by
   default; Slack, Telegram, webhooks, etc. are available).
5. Optionally, create a **Status page** listing both monitors to share
   with the team.

Two monitors are worthwhile because they separate the failures: if
only the backend monitor goes red, the app is up but Supabase (or the
network path to it) is not, so check the
[Supabase status page](https://status.supabase.com) and the project
dashboard before looking at the server.

## Monitoring the WhatsApp webhook

Meta delivers inbound messages to `/api/whatsapp/webhook`. That route
is served by the same process as `/api/health`, so the app monitor
covers it. Don't point UptimeRobot at the webhook itself: it only
answers Meta's signed verification handshake.

## Docker

`docker-compose.yml` uses the same liveness endpoint for its container
healthcheck (`GET /api/health`), so `docker compose ps` and
UptimeRobot agree on what "up" means.
