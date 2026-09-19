// The voice line. Every handler here is a Twilio webhook: Twilio POSTs form-encoded call state, we
// answer with TwiML. Nothing is trusted until the X-Twilio-Signature check passes.
//
//   /voice/incoming   the number was dialled          -> greeting + <Gather> menu
//   /voice/again      back to the menu mid-call       -> <Gather> menu without the greeting
//   /voice/menu       a digit was pressed             -> 1 explain, 2 voicemail, 3 forward to a person
//   /voice/dial-result the forwarded leg ended        -> hang up, or fall through to /voice/voicemail
//   /voice/recorded   the caller finished a message  -> thank + hang up
//   /voice/recording-status, /voice/transcription, /voice/status   async callbacks that enrich the log
//   /voice/fallback   Twilio could not reach the primary URL / it errored -> a polite exit, logged

import type { Env } from "./env";
import { TwiML, verifyTwilioRequest } from "./twilio";
import { callLog, type CallEvent, type CallRecord } from "./log";

const MENU_ATTEMPTS = 2;
const ev = (kind: string, detail?: string): CallEvent => ({ at: new Date().toISOString(), kind, detail });

function menu(env: Env, attempt: number): TwiML {
  const t = new TwiML();
  if (attempt === 1) {
    t.say("Thanks for calling the Transom front desk, a reference build by Levelbrook Consulting.");
  }
  t.gather({ input: "dtmf", numDigits: 1, timeout: 6, action: "/voice/menu", method: "POST" }, (g) => {
    g.say("Press 1 to hear how this line is built. Press 2 to leave a message. Press 3 to reach a person.");
  });
  if (attempt < MENU_ATTEMPTS) t.redirect(`/voice/incoming?attempt=${attempt + 1}`);
  else t.say("We did not get a response. Goodbye.").hangup();
  return t;
}

function voicemail(): TwiML {
  return new TwiML()
    .say("Leave a message after the tone. Press pound when you are done.")
    .record({
      maxLength: 120, timeout: 5, finishOnKey: "#", playBeep: true,
      action: "/voice/recorded", method: "POST",
      recordingStatusCallback: "/voice/recording-status", recordingStatusCallbackMethod: "POST",
      transcribe: true, transcribeCallback: "/voice/transcription",
    })
    .say("We did not hear a message. Goodbye.").hangup();
}

export async function handleVoice(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const p = await verifyTwilioRequest(request, env.TWILIO_AUTH_TOKEN);
  if (!p) return new Response("Bad Twilio signature", { status: 403 });
  const sid = p.CallSid ?? "";
  const url = new URL(request.url);
  const log = callLog(env);

  switch (path) {
    case "/voice/incoming": {
      const attempt = Number(url.searchParams.get("attempt") ?? "1");
      if (attempt === 1) {
        await log.createCall(sid, { from: p.From ?? "", fromCity: p.FromCity, fromState: p.FromState, to: p.To ?? "", status: p.CallStatus ?? "ringing" });
      } else {
        await log.updateCall(sid, {}, ev("menu-timeout", `attempt ${attempt}`));
      }
      return menu(env, attempt).response();
    }

    case "/voice/again": {
      await log.updateCall(sid, {}, ev("menu"));
      return menu(env, 2).response();
    }

    case "/voice/menu": {
      const d = p.Digits ?? "";
      await log.updateCall(sid, { path: [d] }, ev("keypress", d));
      if (d === "1") {
        return new TwiML()
          .say("This number is a Twilio voice line. Twilio sends every call event as a signed web hook to a standalone Cloudflare Worker, which checks the signature, writes the call to a key value store, and answers with TwiML. The same Worker also runs as an edge layer in front of a separate web application, adding rate limiting, caching and a maintenance switch. The source code and the live call log are at transom dot levelbrook dot com.")
          .pause(1)
          .redirect("/voice/again")
          .response();
      }
      if (d === "2") return voicemail().response();
      if (d === "3") {
        if (!env.FORWARD_TO) {
          return new TwiML().say("Forwarding is not configured on this line.").redirect("/voice/voicemail").response();
        }
        return new TwiML()
          .say("Connecting you now.")
          .dial({ timeout: 20, action: "/voice/dial-result", method: "POST", callerId: env.TWILIO_NUMBER }, env.FORWARD_TO)
          .response();
      }
      return new TwiML().say("That is not an option.").redirect("/voice/incoming?attempt=2").response();
    }

    case "/voice/dial-result": {
      const status = p.DialCallStatus ?? "unknown";
      await log.updateCall(sid, { dialStatus: status }, ev("dial", status));
      if (status === "completed") return new TwiML().hangup().response();
      // Busy, no answer, failed: fall through to voicemail rather than dropping the caller.
      return new TwiML().say("No one could pick up right now.").redirect("/voice/voicemail").response();
    }

    case "/voice/voicemail": {
      await log.updateCall(sid, {}, ev("voicemail"));
      return voicemail().response();
    }

    case "/voice/recorded": {
      await log.updateCall(sid, { recordingUrl: p.RecordingUrl, recordingSec: Number(p.RecordingDuration ?? 0) }, ev("recorded", `${p.RecordingDuration ?? "?"}s`));
      return new TwiML().say("Thanks, we have your message. Goodbye.").hangup().response();
    }

    case "/voice/recording-status": {
      const patch: Partial<CallRecord> = {};
      if (p.RecordingUrl) patch.recordingUrl = p.RecordingUrl;
      if (p.RecordingDuration) patch.recordingSec = Number(p.RecordingDuration);
      await log.updateCall(sid, patch, ev("recording-status", p.RecordingStatus));
      return new Response(null, { status: 204 });
    }

    case "/voice/transcription": {
      await log.updateCall(sid, p.TranscriptionStatus === "completed" ? { transcription: p.TranscriptionText } : {}, ev("transcription", p.TranscriptionStatus));
      return new Response(null, { status: 204 });
    }

    case "/voice/status": {
      const patch: Partial<CallRecord> = { status: p.CallStatus };
      if (p.CallDuration) patch.durationSec = Number(p.CallDuration);
      await log.updateCall(sid, patch, ev("status", p.CallStatus));
      return new Response(null, { status: 204 });
    }

    case "/voice/fallback": {
      // Twilio only calls this when the primary webhook failed. Log it and get the caller out cleanly.
      await log.updateCall(sid, {}, ev("fallback", p.ErrorCode));
      return new TwiML().say("Sorry, something went wrong on our side. Please try again later.").hangup().response();
    }
  }
  return new Response("Not found", { status: 404 });
}

/** Inbound SMS to the same number: log it and reply. (A trial Twilio account can only reply to verified numbers.) */
export async function handleSms(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const p = await verifyTwilioRequest(request, env.TWILIO_AUTH_TOKEN);
  if (!p) return new Response("Bad Twilio signature", { status: 403 });
  await callLog(env).createCall(p.MessageSid ?? crypto.randomUUID(), {
    from: p.From ?? "", fromCity: p.FromCity, fromState: p.FromState, to: p.To ?? "", status: "sms",
    events: [ev("sms", (p.Body ?? "").slice(0, 160))],
  });
  return new TwiML().message("Thanks. This line is a reference build; call it to hear the menu, or see transom.levelbrook.com.").response();
}
