export interface Env {
  LOG: KVNamespace;
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
