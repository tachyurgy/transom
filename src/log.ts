// KV-backed call + edge logs. KV lists keys in ascending order, so keys carry an inverted timestamp
// and the newest record lists first. A `sid:<CallSid>` pointer lets later callbacks (status, recording,
// transcription) find and update the record they belong to.

export interface CallEvent { at: string; kind: string; detail?: string }
export interface CallRecord {
  key: string;
  sid: string;
  startedAt: string;
  from: string;          // caller, lightly masked in the public API
  fromCity?: string;
  fromState?: string;
  to: string;
  status: string;
  durationSec?: number;
  path: string[];        // menu choices in order, e.g. ["1","2"]
  recordingUrl?: string;
  recordingSec?: number;
  transcription?: string;
  dialStatus?: string;
  events: CallEvent[];
}

const INV = 9_999_999_999_999;
export const callKey = (ts: number, sid: string) => `call:${String(INV - ts).padStart(13, "0")}:${sid}`;
export const edgeKey = (ts: number, id: string) => `edge:${String(INV - ts).padStart(13, "0")}:${id}`;

export async function createCall(kv: KVNamespace, sid: string, fields: Partial<CallRecord>): Promise<CallRecord> {
  const now = Date.now();
  const rec: CallRecord = {
    key: callKey(now, sid), sid, startedAt: new Date(now).toISOString(),
    from: "", to: "", status: "ringing", path: [], events: [{ at: new Date(now).toISOString(), kind: "incoming" }],
    ...fields,
  };
  await Promise.all([
    kv.put(rec.key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 90 }),
    kv.put(`sid:${sid}`, rec.key, { expirationTtl: 60 * 60 * 24 * 90 }),
  ]);
  return rec;
}

export async function updateCall(kv: KVNamespace, sid: string, mutate: (r: CallRecord) => void): Promise<CallRecord | null> {
  const key = await kv.get(`sid:${sid}`);
  if (!key) return null;
  const raw = await kv.get(key);
  if (!raw) return null;
  const rec = JSON.parse(raw) as CallRecord;
  mutate(rec);
  await kv.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 90 });
  return rec;
}

export async function listCalls(kv: KVNamespace, limit = 25): Promise<CallRecord[]> {
  const { keys } = await kv.list({ prefix: "call:", limit });
  const recs = await Promise.all(keys.map((k) => kv.get(k.name)));
  return recs.filter((r): r is string => !!r).map((r) => JSON.parse(r) as CallRecord);
}

export interface EdgeRecord { id: string; at: string; method: string; path: string; status: number; cache: string; ms: number; colo?: string; country?: string }

export async function logEdge(kv: KVNamespace, rec: EdgeRecord): Promise<void> {
  await kv.put(edgeKey(Date.parse(rec.at), rec.id), JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 7 });
}

export async function listEdge(kv: KVNamespace, limit = 25): Promise<EdgeRecord[]> {
  const { keys } = await kv.list({ prefix: "edge:", limit });
  const recs = await Promise.all(keys.map((k) => kv.get(k.name)));
  return recs.filter((r): r is string => !!r).map((r) => JSON.parse(r) as EdgeRecord);
}

/** +12065550123 -> +1 (206) ***-0123 : enough to recognise your own call, not enough to harvest. */
export function maskNumber(n: string): string {
  const m = n.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+1 (${m[1]}) ***-${m[3]}`;
  return n.length > 4 ? n.slice(0, 3) + "***" + n.slice(-2) : n;
}
