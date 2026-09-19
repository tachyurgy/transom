// transom.levelbrook.com: the human-facing side. Server-rendered from KV on every request, no client
// framework, so what you see is exactly what the Worker knows.

import type { Env } from "./env";
import { callLog, maskNumber, type CallRecord } from "./log";
import { esc } from "./twilio";

const fmtNumber = (n: string) => n.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "+1 ($1) $2-$3");
const when = (iso: string) => iso.replace("T", " ").slice(0, 19) + " UTC";

function callRow(c: CallRecord): string {
  const where = [c.fromCity, c.fromState].filter(Boolean).join(", ");
  const path = c.path.length ? c.path.map((d) => `<kbd>${esc(d)}</kbd>`).join(" ") : "<span class=dim>none</span>";
  const extra: string[] = [];
  if (c.durationSec != null) extra.push(`${c.durationSec}s`);
  if (c.dialStatus) extra.push(`dial: ${esc(c.dialStatus)}`);
  if (c.recordingSec) extra.push(`voicemail ${c.recordingSec}s`);
  if (c.transcription) extra.push(`<q>${esc(c.transcription)}</q>`);
  return `<tr><td>${when(c.startedAt)}</td><td>${esc(maskNumber(c.from))}${where ? `<br><span class=dim>${esc(where)}</span>` : ""}</td><td>${path}</td><td><span class="pill s-${esc(c.status)}">${esc(c.status)}</span></td><td>${extra.join(" · ") || "<span class=dim>—</span>"}</td></tr>`;
}

export async function renderDashboard(env: Env): Promise<Response> {
  const log = callLog(env);
  const [calls, edge] = await Promise.all([log.listCalls(25), log.listEdge(15)]);
  const maint = (await env.LOG.get("edge:maintenance")) === "1";
  const html = `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Transom — a Twilio voice line and an edge layer, both on one Cloudflare Worker</title>
<meta name=description content="A reference build: a real phone number answered by a signature-checked TwiML IVR on a standalone Cloudflare Worker, and the same Worker proxying a Next.js app on Vercel with rate limiting, caching and a maintenance switch.">
<link rel=preconnect href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel=stylesheet>
<style>
:root{--bg:#f6f4ef;--ink:#17191c;--mute:#6b7078;--line:#dcd7cc;--acc:#c8442a;--card:#fffdf8;--mono:"JetBrains Mono",ui-monospace,Menlo,monospace}
@media(prefers-color-scheme:dark){:root{--bg:#121417;--ink:#e8e6df;--mute:#9aa0a8;--line:#2a2f36;--card:#1a1d22}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 "Inter Tight",system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:40px 20px 80px}
h1{font-size:clamp(28px,4vw,42px);line-height:1.1;margin:0 0 8px;letter-spacing:-.02em}h2{font-size:20px;margin:40px 0 12px}
.lede{font-size:18px;color:var(--mute);max-width:70ch;margin:0 0 28px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px}
.card h3{margin:0 0 6px;font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--mute)}
.num{font:600 30px/1.1 var(--mono);letter-spacing:-.01em}.num a{color:inherit;text-decoration:none;border-bottom:2px solid var(--acc)}
ol.menu{margin:8px 0 0;padding-left:22px}ol.menu li{margin:4px 0}
table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-weight:600;color:var(--mute);border-bottom:1px solid var(--line);padding:8px 8px 6px}td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:top}
kbd{font:500 12px var(--mono);background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 6px}
.dim{color:var(--mute)}.pill{font:500 12px var(--mono);padding:2px 8px;border-radius:999px;border:1px solid var(--line)}.s-completed{border-color:#3a9a6e;color:#3a9a6e}.s-in-progress,.s-ringing{border-color:#c98a1b;color:#c98a1b}.s-sms{border-color:#4a7fc9;color:#4a7fc9}
code,pre{font-family:var(--mono);font-size:13px}pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px;overflow:auto;line-height:1.5}
.flow{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:10px;align-items:center;font-size:14px}.flow .box{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}.flow .arr{color:var(--mute);font-family:var(--mono)}
@media(max-width:700px){.flow{grid-template-columns:1fr}.flow .arr{transform:rotate(90deg);text-align:center}}
a{color:var(--acc)}footer{margin-top:60px;color:var(--mute);font-size:14px;border-top:1px solid var(--line);padding-top:16px}
.badge{display:inline-block;font:500 12px var(--mono);padding:2px 8px;border-radius:4px;background:${maint ? "#c8442a" : "#3a9a6e"};color:#fff}
</style></head><body><main>
<h1>Transom</h1>
<p class=lede>A real phone number answered by a Cloudflare Worker, and the same Worker standing in front of a web app it does not own. One <code>wrangler deploy</code>, two hostnames, no servers.</p>

<div class=grid>
<div class=card><h3>Call this number</h3><div class=num><a href="tel:${esc(env.TWILIO_NUMBER)}">${esc(fmtNumber(env.TWILIO_NUMBER))}</a></div>
<ol class=menu><li>Hear how the line is built</li><li>Leave a voicemail (recorded + transcribed)</li><li>Be forwarded to a person, voicemail if no answer</li></ol>
<p class=dim style="font-size:13px;margin:10px 0 0">Your call appears in the log below within seconds, number partly masked. The Twilio account behind this line is a trial, so Twilio plays a short notice before the menu.</p></div>
<div class=card><h3>Edge layer in front of a Vercel app</h3><div class=num style="font-size:20px"><a href="https://${esc(env.EDGE_HOST)}/">${esc(env.EDGE_HOST)}</a></div>
<p style="margin:8px 0 0">Same Worker, second route. Proxies <a href="${esc(env.ORIGIN)}">${esc(env.ORIGIN.replace("https://", ""))}</a> (Next.js on Vercel) and adds rate limiting, an edge cache, a maintenance switch, security headers and a request id. Look for the bar at the bottom of the page and the <code>x-edge</code> headers.</p>
<p style="margin:10px 0 0">Maintenance switch: <span class=badge>${maint ? "ON — serving 503" : "off — passing through"}</span></p></div>
</div>

<h2>How a call moves</h2>
<div class=flow>
<div class=box><b>Caller</b><br>dials the Twilio number</div><div class=arr>→ SIP/PSTN →</div>
<div class=box><b>Twilio</b><br>POSTs call state to the webhook, signed with <code>X-Twilio-Signature</code></div><div class=arr>→ HTTPS →</div>
<div class=box><b>Worker</b><br>verifies HMAC-SHA1, writes KV, answers TwiML (<code>Gather</code>, <code>Record</code>, <code>Dial</code>)</div>
</div>

<h2>Live call log</h2>
<table><thead><tr><th>Started</th><th>From</th><th>Keys</th><th>Status</th><th>Detail</th></tr></thead><tbody>
${calls.length ? calls.map(callRow).join("") : `<tr><td colspan=5 class=dim>No calls yet. Be the first.</td></tr>`}
</tbody></table>
<p class=dim style="font-size:13px">JSON: <a href="/api/calls">/api/calls</a> · <a href="/api/edge">/api/edge</a> · <a href="/healthz">/healthz</a></p>

<h2>Recent documents served through the edge</h2>
<table><thead><tr><th>At</th><th>Path</th><th>Status</th><th>Cache</th><th>Colo</th><th>ms</th></tr></thead><tbody>
${edge.length ? edge.map((e) => `<tr><td>${when(e.at)}</td><td><code>${esc(e.path)}</code></td><td>${e.status}</td><td><code>${esc(e.cache)}</code></td><td>${esc(e.colo ?? "")}</td><td>${e.ms}</td></tr>`).join("") : `<tr><td colspan=6 class=dim>Nothing yet. Open <a href="https://${esc(env.EDGE_HOST)}/">${esc(env.EDGE_HOST)}</a>.</td></tr>`}
</tbody></table>

<h2>What is in the Worker</h2>
<pre>src/index.ts      hostname + path router (one Worker, two routes)
src/twilio.ts     X-Twilio-Signature verification (WebCrypto HMAC-SHA1, constant-time compare) + a TwiML builder
src/voice.ts      /voice/incoming, /menu, /voicemail, /dial-result, /recorded, /recording-status, /transcription, /status, /fallback
src/edge.ts       rate limit → maintenance switch → edge cache → origin fetch → header rewrite → HTMLRewriter banner
src/log.ts        KV call log with inverted-timestamp keys and a CallSid pointer for async callbacks
wrangler.toml     routes on both hostnames, KV binding, rate-limit binding, vars; secrets via wrangler secret put
scripts/          provision-number.sh (buys + wires a number), simulate-call.sh (signed webhook walk-through)</pre>
<p>Source: <a href="https://github.com/tachyurgy/transom">github.com/tachyurgy/transom</a>. Built by <a href="https://consulting.levelbrook.com/">Levelbrook Consulting</a>.</p>
<footer>Transom: the small window above a door. It lets light through and stays out of the way.</footer>
</main><script src="https://levelbrook.com/lb.js" defer></script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export async function apiCalls(env: Env): Promise<Response> {
  const calls = await callLog(env).listCalls(50);
  const safe = calls.map(({ from, recordingUrl: _r, ...rest }) => ({ ...rest, from: maskNumber(from) }));
  return new Response(JSON.stringify(safe, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function apiEdge(env: Env): Promise<Response> {
  return new Response(JSON.stringify(await callLog(env).listEdge(50), null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
