import type { CallLog } from "./log";

export interface Env {
  LOG: KVNamespace;                          // maintenance flag only
  CALL_LOG: DurableObjectNamespace<CallLog>; // call + edge logs (strongly consistent)
  EDGE_RL: { limit(opts: { key: string }): Promise<{ success: boolean }> };
  SITE_HOST: string;
  EDGE_HOST: string;
  ORIGIN: string;
  TWILIO_NUMBER: string;
  // secrets
  TWILIO_AUTH_TOKEN: string;
  FORWARD_TO?: string;
  ADMIN_TOKEN?: string;
}
