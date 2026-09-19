// The edge layer: this Worker bound to a second hostname, standing in front of a third-party origin
// (a Next.js app on Vercel it does not own). What it adds on the way through:
//
//   * per-client-IP rate limiting (Workers Rate Limiting binding)     -> 429 with Retry-After
//   * a maintenance switch held in KV, flipped over an authenticated API -> 503 page, origin untouched
//   * an explicit edge cache for GET responses (Cache API)               -> x-edge-cache: HIT | MISS | BYPASS
//   * request-id + forwarded headers to the origin, hop-by-hop and fingerprint headers stripped on the way back
//   * a security-header baseline the origin does not set
//   * a visible banner injected with HTMLRewriter so a human can see the layer is there
//   * /__edge/health and /__edge/maintenance operator endpoints, plus a sampled request log for the dashboard

import type { Env } from "./env";
import { logEdge } from "./log";

const MAINT_KEY = "edge:maintenance";
const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-authenticate"];
const STRIP_FROM_ORIGIN = ["x-powered-by", "server", "x-vercel-id", "x-vercel-cache", "x-vercel-execution-region", "alt-svc"];

export function securityHeaders(h: Headers): void {
  h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "SAMEORIGIN");
  h.set("referrer-policy", "strict-origin-when-cross-origin");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
}

/** Build the origin request: same path/query, origin host, forwarding + tracing headers, hop-by-hop removed. */
export function buildOriginRequest(request: Request, origin: string, requestId: string): Request {
  const inUrl = new URL(request.url);
  const outUrl = new URL(inUrl.pathname + inUrl.search, origin);
  const h = new Headers(request.headers);
  for (const k of HOP_BY_HOP) h.delete(k);
  h.set("x-forwarded-host", inUrl.host);
  h.set("x-forwarded-proto", "https");
  h.set("x-request-id", requestId);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) h.set("x-edge-client-ip", ip);
  h.set("accept-encoding", "identity"); // let HTMLRewriter see plain bytes; Cloudflare re-compresses to the client
  return new Request(outUrl.toString(), { method: request.method, headers: h, body: request.body, redirect: "manual" });
}

/** Rewrite the origin's response headers for the client. */
export function rewriteResponseHeaders(h: Headers, requestId: string, cache: string): void {
  for (const k of [...HOP_BY_HOP, ...STRIP_FROM_ORIGIN]) h.delete(k);
  h.set("x-edge", "transom");
  h.set("x-request-id", requestId);
  h.set("x-edge-cache", cache);
  securityHeaders(h);
}

function maintenancePage(host: string): Response {
  const html = `<!doctype html><meta charset=utf-8><title>Back shortly</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:20vh auto;padding:0 1rem;color:#222}h1{font-size:1.6rem}code{background:#eee;padding:.1em .3em}</style>
<h1>${host} is in maintenance mode</h1><p>The edge layer is serving this page; the origin is not being contacted. Flip the switch off and traffic resumes instantly.</p><p><code>x-edge: transom</code></p>`;
  return new Response(html, { status: 503, headers: { "content-type": "text/html; charset=utf-8", "retry-after": "60", "cache-control": "no-store", "x-edge": "transom" } });
}

function banner(requestId: string, cache: string, colo: string): string {
  return `<div id="transom-edge" style="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;background:#101418;color:#d9e0e6;padding:6px 12px;display:flex;gap:16px;flex-wrap:wrap;border-top:1px solid #2a3340">
<span><b style="color:#7fd1ae">transom edge</b> in front of this app</span><span>cache: ${cache}</span><span>colo: ${colo}</span><span>request: ${requestId.slice(0, 8)}</span><a href="https://transom.levelbrook.com/" style="color:#9cc4ff;margin-left:auto">how it works</a></div>`;
}

export async function handleEdge(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const requestId = requestIdFor(request);
  const t0 = Date.now();
  const cf = (request as Request & { cf?: { colo?: string; country?: string } }).cf ?? {};

  // Operator endpoints on the edge hostname itself.
  if (url.pathname === "/__edge/health") {
    const maint = (await env.LOG.get(MAINT_KEY)) === "1";
    return json({ ok: true, origin: env.ORIGIN, maintenance: maint, colo: cf.colo, requestId });
  }
  if (url.pathname === "/__edge/maintenance") {
    if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, 401);
    if (request.method === "POST") { await env.LOG.put(MAINT_KEY, "1"); return json({ maintenance: true }); }
    if (request.method === "DELETE") { await env.LOG.delete(MAINT_KEY); return json({ maintenance: false }); }
    return json({ error: "method" }, 405);
  }

  // 1. Rate limit per client IP.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const rl = await env.EDGE_RL.limit({ key: ip });
  if (!rl.success) {
    return new Response("Too many requests\n", { status: 429, headers: { "retry-after": "60", "x-edge": "transom", "x-request-id": requestId } });
  }

  // 2. Maintenance switch.
  if ((await env.LOG.get(MAINT_KEY)) === "1") return maintenancePage(url.host);

  // 3. Edge cache for GETs (Cache API is per-colo; that is fine for a read-mostly app).
  const cacheable = request.method === "GET" && !request.headers.get("authorization") && !request.headers.get("cookie");
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  let cacheState = cacheable ? "MISS" : "BYPASS";
  let res: Response | undefined;
  if (cacheable) {
    const hit = await cache.match(cacheKey);
    if (hit) { res = new Response(hit.body, hit); cacheState = "HIT"; }
  }

  // 4. Go to the origin.
  if (!res) {
    const originRes = await fetch(buildOriginRequest(request, env.ORIGIN, requestId));
    res = new Response(originRes.body, originRes);
    // Only cache what the origin says is cacheable, for a bounded time.
    const cc = originRes.headers.get("cache-control") ?? "";
    if (cacheable && originRes.ok && !/no-store|private/.test(cc)) {
      const toStore = new Response(res.clone().body, res);
      toStore.headers.set("cache-control", /_next\/static/.test(url.pathname) ? "public, max-age=31536000, immutable" : "public, max-age=60");
      ctx.waitUntil(cache.put(cacheKey, toStore));
    }
  }

  // 5. Shape the response for the client.
  rewriteResponseHeaders(res.headers, requestId, cacheState);
  const isHtml = (res.headers.get("content-type") ?? "").includes("text/html");
  if (isHtml) {
    res = new HTMLRewriter()
      .on("body", { element(el) { el.append(banner(requestId, cacheState, cf.colo ?? "?"), { html: true }); } })
      .transform(res);
    // Sample the log: one row per HTML document, never per asset.
    ctx.waitUntil(logEdge(env.LOG, { id: requestId, at: new Date(t0).toISOString(), method: request.method, path: url.pathname, status: res.status, cache: cacheState, ms: Date.now() - t0, colo: cf.colo, country: cf.country }));
  }
  return res;
}

function requestIdFor(_request: Request): string {
  // Always minted here, never taken from the client: the id is echoed into HTML and log rows.
  return crypto.randomUUID();
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-edge": "transom" } });
}
