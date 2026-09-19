#!/usr/bin/env bash
# Buy a voice-capable US number and wire every webhook at the Twilio number. Idempotent for the webhook
# part: pass an existing number as $2 to re-point it instead of buying.
#   TWILIO_ACCOUNT_SID=AC... TWILIO_AUTH_TOKEN=... ./scripts/provision-number.sh https://transom.levelbrook.com [+1206...]
set -euo pipefail
BASE="${1:?base url of the deployed Worker}"; NUMBER="${2:-}"
: "${TWILIO_ACCOUNT_SID:?}" "${TWILIO_AUTH_TOKEN:?}"
API="https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID"
auth=(-u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN")

webhooks=(
  --data-urlencode "VoiceUrl=$BASE/voice/incoming"        --data-urlencode "VoiceMethod=POST"
  --data-urlencode "VoiceFallbackUrl=$BASE/voice/fallback" --data-urlencode "VoiceFallbackMethod=POST"
  --data-urlencode "StatusCallback=$BASE/voice/status"     --data-urlencode "StatusCallbackMethod=POST"
  --data-urlencode "SmsUrl=$BASE/sms/incoming"             --data-urlencode "SmsMethod=POST"
)

if [[ -z "$NUMBER" ]]; then
  AREA="${AREA_CODE:-206}"
  NUMBER=$(curl -s "${auth[@]}" "$API/AvailablePhoneNumbers/US/Local.json?AreaCode=$AREA&VoiceEnabled=true&PageSize=1" \
    | python3 -c 'import json,sys;print(json.load(sys.stdin)["available_phone_numbers"][0]["phone_number"])')
  echo "buying $NUMBER"
  curl -s "${auth[@]}" -X POST "$API/IncomingPhoneNumbers.json" --data-urlencode "PhoneNumber=$NUMBER" \
    --data-urlencode "FriendlyName=transom front desk" "${webhooks[@]}" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("sid"),d.get("phone_number"),d.get("voice_url"),d.get("message") or "")'
else
  PN=$(curl -s "${auth[@]}" "$API/IncomingPhoneNumbers.json?PhoneNumber=$NUMBER" | python3 -c 'import json,sys;print(json.load(sys.stdin)["incoming_phone_numbers"][0]["sid"])')
  echo "re-pointing $NUMBER ($PN)"
  curl -s "${auth[@]}" -X POST "$API/IncomingPhoneNumbers/$PN.json" "${webhooks[@]}" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("phone_number"),d.get("voice_url"),d.get("status_callback"))'
fi
