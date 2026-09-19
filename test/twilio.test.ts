import { describe, it, expect } from "vitest";
import { twilioSignature, verifyTwilioRequest, TwiML, esc } from "../src/twilio";

// The worked example from Twilio's webhook-security docs.
const TOKEN = "12345";
const URL_ = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = { CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212" };
const EXPECTED = "0/KCTR6DLpKmkAf8muzZqo1nDgQ=";

describe("X-Twilio-Signature", () => {
  it("reproduces Twilio's documented vector", async () => {
    expect(await twilioSignature(TOKEN, URL_, PARAMS)).toBe(EXPECTED);
  });
  it("accepts a correctly signed request and returns its params", async () => {
    const body = new URLSearchParams(PARAMS);
    const req = new Request(URL_, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": EXPECTED } });
    expect(await verifyTwilioRequest(req, TOKEN)).toEqual(PARAMS);
  });
  it("rejects a tampered body", async () => {
    const body = new URLSearchParams({ ...PARAMS, Digits: "9999" });
    const req = new Request(URL_, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": EXPECTED } });
    expect(await verifyTwilioRequest(req, TOKEN)).toBeNull();
  });
  it("rejects a request signed for a different URL (query string matters)", async () => {
    const body = new URLSearchParams(PARAMS);
    const req = new Request("https://mycompany.com/myapp.php?foo=1", { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": EXPECTED } });
    expect(await verifyTwilioRequest(req, TOKEN)).toBeNull();
  });
  it("rejects a missing signature", async () => {
    const req = new Request(URL_, { method: "POST", body: new URLSearchParams(PARAMS) });
    expect(await verifyTwilioRequest(req, TOKEN)).toBeNull();
  });
});

describe("TwiML builder", () => {
  it("escapes text and attributes", () => {
    expect(esc(`a<b>&"c"'d'`)).toBe("a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;");
    const xml = new TwiML().say("Tom & Jerry <3").toString();
    expect(xml).toContain("<Say voice=\"Google.en-US-Neural2-D\">Tom &amp; Jerry &lt;3</Say>");
  });
  it("nests Gather and renders a full response", () => {
    const xml = new TwiML().gather({ numDigits: 1, action: "/voice/menu" }, (g) => g.say("Press 1")).redirect("/voice/incoming?attempt=2").toString();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><Response>')).toBe(true);
    expect(xml).toContain('<Gather numDigits="1" action="/voice/menu"><Say voice="Google.en-US-Neural2-D">Press 1</Say></Gather>');
    expect(xml).toContain('<Redirect method="POST">/voice/incoming?attempt=2</Redirect>');
  });
  it("omits undefined attributes and serves text/xml", async () => {
    const res = new TwiML().record({ maxLength: 120, transcribeCallback: undefined }).response();
    expect(res.headers.get("content-type")).toBe("text/xml; charset=utf-8");
    expect(await res.text()).toContain('<Record maxLength="120"/>');
  });
});
