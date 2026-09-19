// Twilio webhook security + TwiML construction, dependency-free on the Workers runtime.
//
// Twilio signs every webhook it sends: X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sortedParams))
// where sortedParams is every POST field's key immediately followed by its value, keys sorted
// lexicographically, no separators. The URL is the full URL Twilio requested, query string included.
// https://www.twilio.com/docs/usage/webhooks/webhooks-security

const enc = new TextEncoder();

export async function twilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const k of keys) data += k + params[k];
  const key = await crypto.subtle.importKey("raw", enc.encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** Read the form body and verify the request really came from Twilio. Returns the params on success, null on failure. */
export async function verifyTwilioRequest(request: Request, authToken: string): Promise<Record<string, string> | null> {
  const sig = request.headers.get("x-twilio-signature");
  if (!sig) return null;
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = typeof v === "string" ? v : "";
  // Cloudflare hands the Worker the URL the client (Twilio) asked for, so no host/proto reconstruction is needed.
  const expected = await twilioSignature(authToken, request.url, params);
  return timingSafeEqual(expected, sig) ? params : null;
}

// ---- TwiML ---------------------------------------------------------------------------------------

export function esc(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c] as string));
}

type Attrs = Record<string, string | number | boolean | undefined>;

function attrs(a: Attrs): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join("");
}

/** A tiny TwiML builder: `twiml.say("hi").gather({...}, (g) => g.say("press 1"))`. */
export class TwiML {
  private parts: string[] = [];
  say(text: string, a: Attrs = {}): this {
    this.parts.push(`<Say${attrs({ voice: "Google.en-US-Neural2-D", ...a })}>${esc(text)}</Say>`);
    return this;
  }
  pause(seconds = 1): this { this.parts.push(`<Pause${attrs({ length: seconds })}/>`); return this; }
  play(url: string): this { this.parts.push(`<Play>${esc(url)}</Play>`); return this; }
  gather(a: Attrs, inner: (g: TwiML) => void): this {
    const g = new TwiML(); inner(g);
    this.parts.push(`<Gather${attrs(a)}>${g.inner()}</Gather>`);
    return this;
  }
  record(a: Attrs): this { this.parts.push(`<Record${attrs(a)}/>`); return this; }
  dial(a: Attrs, number: string): this {
    this.parts.push(`<Dial${attrs(a)}><Number>${esc(number)}</Number></Dial>`);
    return this;
  }
  message(text: string): this { this.parts.push(`<Message>${esc(text)}</Message>`); return this; }
  redirect(url: string, method = "POST"): this { this.parts.push(`<Redirect${attrs({ method })}>${esc(url)}</Redirect>`); return this; }
  hangup(): this { this.parts.push("<Hangup/>"); return this; }
  inner(): string { return this.parts.join(""); }
  toString(): string { return `<?xml version="1.0" encoding="UTF-8"?><Response>${this.inner()}</Response>`; }
  response(): Response {
    return new Response(this.toString(), { headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } });
  }
}
