# Transom

A real phone number answered by a Cloudflare Worker, and the same Worker standing in front of a web app it does not own. One `wrangler deploy`, two hostnames, no servers.

- **Call it:** +1 (206) 984-4716 · dashboard and live call log at https://transom.levelbrook.com
- **Edge layer:** https://plumbline-edge.levelbrook.com — the Worker proxying a Next.js app on Vercel

Transom is the small window above a door. It lets light through and stays out of the way.

## What it does

### 1. A Twilio voice line, answered by the Worker

Twilio POSTs every call event to the Worker. The Worker verifies `X-Twilio-Signature` (HMAC-SHA1 over URL + sorted params, constant-time compare, WebCrypto, no SDK), writes the call to KV, and answers with TwiML.

| Webhook | What happens |
|---|---|
| `POST /voice/incoming` | greeting, `<Gather>` a single digit; re-prompts once, then hangs up |
| `POST /voice/menu` | `1` explains the build in speech · `2` voicemail · `3` `<Dial>` a person, voicemail if busy/no answer |
| `POST /voice/voicemail` | `<Record>` up to 120s, `#` to finish, transcription requested |
| `POST /voice/recorded` | thanks and hangs up; the recording URL and duration land in the log |
| `POST /voice/recording-status`, `/voice/transcription`, `/voice/status` | async callbacks that enrich the same log record via a `sid:<CallSid>` pointer |
| `POST /voice/fallback` | Twilio only calls this if the primary URL failed; a polite exit, logged with the error code |
| `POST /sms/incoming` | logs a text and replies |

Every handler returns 403 to anything Twilio did not sign. `scripts/simulate-call.sh` walks the whole menu against the deployed Worker with correctly signed requests, using an independent bash/openssl signer, so the verifier is checked from outside the codebase.

### 2. An edge layer in front of a third-party app

The same Worker on a second route (`plumbline-edge.levelbrook.com/*`) proxies `https://plumbline.levelbrook.com` (Next.js, Vercel) and adds, in order:

1. **Rate limiting** per client IP with the Workers Rate Limiting binding (120 req/min) → `429` + `Retry-After`
2. **Maintenance switch** held in KV, flipped with `POST`/`DELETE /__edge/maintenance` under a bearer token → `503` page, origin never contacted
3. **Edge cache** for anonymous GETs via the Cache API, honouring the origin's `no-store`/`private` → `x-edge-cache: HIT | MISS | BYPASS`
4. **Origin fetch** with `x-forwarded-host`, `x-forwarded-proto`, `x-request-id`, `x-edge-client-ip`; hop-by-hop headers dropped
5. **Response shaping**: `x-powered-by`, `server`, `x-vercel-*` stripped; HSTS, `nosniff`, frame and referrer policies added; `x-edge: transom` and the request id echoed
6. **HTMLRewriter** appends a small status bar to every HTML document so a human can see the layer is there
7. **Sampled log** (one KV row per HTML document, never per asset) feeding the dashboard

`GET /__edge/health` reports origin, colo, and the maintenance state.

## Layout

```
src/index.ts      hostname + path router
src/twilio.ts     signature verification + TwiML builder
src/voice.ts      the IVR
src/edge.ts       the proxy
src/log.ts        KV call/edge log (inverted-timestamp keys list newest first)
src/dashboard.ts  server-rendered dashboard + /api/calls, /api/edge
test/             vitest: Twilio's documented signature vector, TwiML escaping, header rewriting, key ordering
scripts/          provision-number.sh, simulate-call.sh
wrangler.toml     routes, KV, rate limit binding, vars
```

## Deploy from nothing

```bash
npm install
npx wrangler kv namespace create LOG            # paste the id into wrangler.toml
# DNS: a proxied AAAA 100:: for each hostname in wrangler.toml routes (placeholder records for Worker routes)
npx wrangler deploy
printf '%s' "$TWILIO_AUTH_TOKEN" | npx wrangler secret put TWILIO_AUTH_TOKEN
printf '%s' "+1..."              | npx wrangler secret put FORWARD_TO      # where "3" forwards to
printf '%s' "$(openssl rand -hex 24)" | npx wrangler secret put ADMIN_TOKEN # maintenance switch
TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... ./scripts/provision-number.sh https://transom.levelbrook.com
TWILIO_AUTH_TOKEN=... ./scripts/simulate-call.sh https://transom.levelbrook.com
```

`npm test` runs the unit tests; `npm run tail` streams production logs.

## Things worth knowing

- **The request URL Twilio signs must be the URL the Worker sees.** Behind Cloudflare routes it is; behind some proxies you would have to reconstruct it from `x-forwarded-*` before hashing.
- **Async callbacks arrive out of order** (`status: completed` can land before `transcription`). The log is keyed by CallSid so each callback merges into the same record.
- **`<Dial>` with an `action` is what makes forwarding safe:** busy/no-answer/failed all fall through to voicemail instead of dropping the caller.
- **The Rate Limiting binding counts per Cloudflare machine, not globally.** Fine for abuse control; for strict global quotas use a Durable Object.
- **Cache API is per colo.** A second colo sees a MISS. Acceptable for a read-mostly origin; use `cf.cacheEverything` or a KV-backed cache if you need it global.
- **Trial Twilio accounts** play a short notice before the call reaches TwiML and can only `<Dial>` or SMS verified numbers. The line here runs on a trial; everything after the notice is real.

MIT.
