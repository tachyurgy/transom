#!/usr/bin/env bash
# Walk the IVR exactly as Twilio would, with correctly signed webhooks, against a deployed transom.
#   TWILIO_AUTH_TOKEN=... ./scripts/simulate-call.sh https://transom.levelbrook.com
# Prints each TwiML response. The call shows up in the dashboard log as a "simulated" caller.
set -euo pipefail
BASE="${1:-https://transom.levelbrook.com}"
: "${TWILIO_AUTH_TOKEN:?set TWILIO_AUTH_TOKEN}"
SID="CAsim$(date +%s)"
FROM="${FROM:-+15005550006}"   # Twilio's magic "valid" test number

sign() { # url, then key=value pairs (already sorted by caller)
  local url="$1"; shift; local data="$url"
  for kv in "$@"; do data+="${kv%%=*}${kv#*=}"; done
  printf '%s' "$data" | openssl dgst -sha1 -hmac "$TWILIO_AUTH_TOKEN" -binary | base64
}
post() { # path, then key=value pairs (sorted)
  local path="$1" url="$BASE$1"; shift
  local sig; sig=$(sign "$url" "$@")
  local args=(); for kv in "$@"; do args+=(--data-urlencode "$kv"); done
  echo; echo "POST $path"; curl -s -X POST -H "X-Twilio-Signature: $sig" "${args[@]}" "$url"; echo
}

post /voice/incoming "CallSid=$SID" "CallStatus=ringing" "From=$FROM" "FromCity=SEATTLE" "FromState=WA" "To=+12069844716"
post /voice/menu     "CallSid=$SID" "CallStatus=in-progress" "Digits=1" "From=$FROM" "To=+12069844716"
post /voice/menu     "CallSid=$SID" "CallStatus=in-progress" "Digits=2" "From=$FROM" "To=+12069844716"
post /voice/recorded "CallSid=$SID" "CallStatus=in-progress" "From=$FROM" "RecordingDuration=7" "RecordingUrl=https://api.twilio.com/example/RE0" "To=+12069844716"
post /voice/status   "CallDuration=48" "CallSid=$SID" "CallStatus=completed" "From=$FROM" "To=+12069844716"
echo; echo "--- unsigned request must be refused ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST --data "CallSid=$SID" "$BASE/voice/incoming"
