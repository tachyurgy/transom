// One Worker, two jobs, picked by hostname:
//   SITE_HOST  -> Twilio voice webhooks, the dashboard and the JSON API
//   EDGE_HOST  -> the edge layer in front of ORIGIN
import type { Env } from "./env";
import { handleVoice, handleSms } from "./voice";
import { handleEdge } from "./edge";
import { renderDashboard, apiCalls, apiEdge } from "./dashboard";

export { CallLog } from "./log";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === env.EDGE_HOST) return handleEdge(request, env, ctx);

    const p = url.pathname;
    if (p.startsWith("/voice/")) return handleVoice(request, env, p);
    if (p === "/sms/incoming") return handleSms(request, env);
    if (p === "/api/calls") return apiCalls(env);
    if (p === "/api/edge") return apiEdge(env);
    if (p === "/healthz") return new Response(JSON.stringify({ ok: true, number: env.TWILIO_NUMBER, edge: env.EDGE_HOST }), { headers: { "content-type": "application/json" } });
    if (p === "/") return renderDashboard(env);
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
