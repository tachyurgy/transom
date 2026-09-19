# Releases

## 2026-09-19 — first deploy
- **What deployed:** Worker `transom` on `transom.levelbrook.com/*` and `plumbline-edge.levelbrook.com/*` (Cloudflare, `wrangler deploy`); Twilio number +1 (206) 984-4716 wired to it.
- **Changed:** initial build — signed Twilio webhooks + IVR (menu, explain, voicemail with transcription, forward with fallback), KV call log, server-rendered dashboard + JSON API; edge layer with rate limit, maintenance switch, edge cache, header rewrite, HTMLRewriter banner.
- **How:** `npx wrangler kv namespace create LOG`; two proxied `AAAA 100::` records; `npx wrangler deploy`; `wrangler secret put` × 3; `scripts/provision-number.sh`.
- **Verified:** 13/13 unit tests; `scripts/simulate-call.sh` full menu walk with signed requests (unsigned → 403); a real call placed through Twilio's API into the number walked the menu (see the call log); edge: Vercel fingerprints stripped, security headers present, banner injected, asset MISS→HIT, maintenance 503/401/200 cycle, 429s after the per-connection limit.
