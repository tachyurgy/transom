// The log lives in one SQLite-backed Durable Object. A call's webhooks arrive seconds apart from
// different Twilio hosts and must see each other's writes (menu -> voicemail -> status), which KV's
// eventual consistency does not promise. A single DO gives strong consistency, real SQL, and ordering
// for free; the traffic here is a few writes per call, far below what one object can carry.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

export interface CallEvent { at: string; kind: string; detail?: string }
export interface CallRecord {
  sid: string;
  startedAt: string;
  from: string;
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

export interface EdgeRecord { id: string; at: string; method: string; path: string; status: number; cache: string; ms: number; colo?: string; country?: string }

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS calls (sid TEXT PRIMARY KEY, started_at TEXT NOT NULL, record TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS calls_started ON calls(started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS edge (id TEXT PRIMARY KEY, at TEXT NOT NULL, record TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS edge_at ON edge(at DESC)`,
];

export class CallLog extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Schema is applied once per object before any request is served; re-runs are no-ops.
    ctx.blockConcurrencyWhile(async () => { for (const m of MIGRATIONS) ctx.storage.sql.exec(m); });
  }

  createCall(sid: string, fields: Partial<CallRecord>): CallRecord {
    const now = new Date().toISOString();
    const rec: CallRecord = { sid, startedAt: now, from: "", to: "", status: "ringing", path: [], events: [{ at: now, kind: "incoming" }], ...fields };
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO calls (sid, started_at, record) VALUES (?, ?, ?)`, sid, now, JSON.stringify(rec));
    return rec;
  }

  /** Merge a change into an existing record. Returns null if the CallSid was never seen. */
  updateCall(sid: string, patch: Partial<CallRecord>, event?: CallEvent): CallRecord | null {
    const row = this.ctx.storage.sql.exec<{ record: string }>(`SELECT record FROM calls WHERE sid = ?`, sid).toArray()[0];
    if (!row) return null;
    const rec = JSON.parse(row.record) as CallRecord;
    Object.assign(rec, patch);
    if (patch.path) rec.path = [...(JSON.parse(row.record) as CallRecord).path, ...patch.path];
    if (event) rec.events.push(event);
    this.ctx.storage.sql.exec(`UPDATE calls SET record = ? WHERE sid = ?`, JSON.stringify(rec), sid);
    return rec;
  }

  deleteCall(sid: string): boolean {
    return this.ctx.storage.sql.exec(`DELETE FROM calls WHERE sid = ?`, sid).rowsWritten > 0;
  }

  listCalls(limit = 25): CallRecord[] {
    return this.ctx.storage.sql.exec<{ record: string }>(`SELECT record FROM calls ORDER BY started_at DESC LIMIT ?`, limit).toArray().map((r) => JSON.parse(r.record) as CallRecord);
  }

  logEdge(rec: EdgeRecord): void {
    this.ctx.storage.sql.exec(`INSERT OR REPLACE INTO edge (id, at, record) VALUES (?, ?, ?)`, rec.id, rec.at, JSON.stringify(rec));
    this.ctx.storage.sql.exec(`DELETE FROM edge WHERE id NOT IN (SELECT id FROM edge ORDER BY at DESC LIMIT 500)`);
  }

  listEdge(limit = 25): EdgeRecord[] {
    return this.ctx.storage.sql.exec<{ record: string }>(`SELECT record FROM edge ORDER BY at DESC LIMIT ?`, limit).toArray().map((r) => JSON.parse(r.record) as EdgeRecord);
  }
}

/** The one log object everybody talks to. */
export function callLog(env: { CALL_LOG: DurableObjectNamespace<CallLog> }): DurableObjectStub<CallLog> {
  return env.CALL_LOG.get(env.CALL_LOG.idFromName("log"));
}

/** +12065550123 -> +1 (206) ***-0123 : enough to recognise your own call, not enough to harvest. */
export function maskNumber(n: string): string {
  const m = n.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  if (m) return `+1 (${m[1]}) ***-${m[3]}`;
  return n.length > 4 ? n.slice(0, 3) + "***" + n.slice(-2) : n;
}
