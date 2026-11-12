import { defineAdapter } from "./define"

export const telnyx = defineAdapter({
  id: "telnyx",
  name: "Telnyx",
  monogram: "Tx",
  description:
    "Messaging (SMS/MMS) and Programmable Fax. Webhooks are signed with Ed25519 using a local key pair.",
  channels: ["sms", "fax"],
  port: 4102,
  apiPrefix: "/v2",
  version: "0.1.0",
  docsUrl: "https://developers.telnyx.com/api",
  outbound: [
    {
      method: "POST",
      path: "/v2/messages",
      summary: "Send an SMS or MMS",
      channel: "sms",
      support: "full",
    },
    {
      method: "GET",
      path: "/v2/messages/{id}",
      summary: "Retrieve a message",
      channel: "sms",
      support: "full",
    },
    {
      method: "POST",
      path: "/v2/messages/number_pool",
      summary: "Send using a number pool",
      channel: "sms",
      support: "planned",
    },
    {
      method: "GET",
      path: "/v2/messaging_profiles",
      summary: "List messaging profiles",
      channel: "sms",
      support: "partial",
    },
    {
      method: "GET",
      path: "/v2/phone_numbers",
      summary: "List phone numbers",
      channel: "sms",
      support: "partial",
    },
    {
      method: "POST",
      path: "/v2/faxes",
      summary: "Send a fax",
      channel: "fax",
      support: "full",
    },
    {
      method: "GET",
      path: "/v2/faxes",
      summary: "List faxes",
      channel: "fax",
      support: "full",
    },
    {
      method: "GET",
      path: "/v2/faxes/{id}",
      summary: "Retrieve a fax",
      channel: "fax",
      support: "full",
    },
    {
      method: "DELETE",
      path: "/v2/faxes/{id}",
      summary: "Delete a fax",
      channel: "fax",
      support: "partial",
    },
    {
      method: "POST",
      path: "/v2/faxes/{id}/actions/cancel",
      summary: "Cancel a queued fax",
      channel: "fax",
      support: "planned",
    },
  ],
  inbound: [
    {
      event: "message.received",
      channel: "sms",
      trigger: "An inbox texts one of the app's numbers",
      urlSetting: "messagingUrl",
    },
    {
      event: "message.sent",
      channel: "sms",
      trigger: "An outbound message is handed to the carrier",
      urlSetting: "messagingUrl",
    },
    {
      event: "message.finalized",
      channel: "sms",
      trigger: "An outbound message is delivered or fails",
      urlSetting: "messagingUrl",
    },
    {
      event: "fax.received",
      channel: "fax",
      trigger: "An inbox faxes one of the app's numbers",
      urlSetting: "faxUrl",
    },
    {
      event: "fax.queued",
      channel: "fax",
      trigger: "POST /v2/faxes is accepted",
      urlSetting: "faxUrl",
    },
    {
      event: "fax.media.processed",
      channel: "fax",
      trigger: "The media_url has been fetched and rendered",
      urlSetting: "faxUrl",
    },
    {
      event: "fax.sending.started",
      channel: "fax",
      trigger: "Transmission to the inbox starts",
      urlSetting: "faxUrl",
    },
    {
      event: "fax.delivered",
      channel: "fax",
      trigger: "The inbox has every page",
      urlSetting: "faxUrl",
    },
    {
      event: "fax.failed",
      channel: "fax",
      trigger: "A fault rule fails the transmission",
      urlSetting: "faxUrl",
    },
  ],
  settings: [
    {
      key: "failNumbers",
      label: "Fail sends to these numbers",
      kind: "text",
      defaultValue: "",
      group: "outbound",
      description:
        "Comma-separated E.164 numbers. Texts end in delivery_failed (40008); faxes fail with user_busy.",
    },
    {
      key: "appNumbers",
      label: "App phone numbers",
      kind: "text",
      defaultValue: "+16285550100, +16285550111, +16285550150",
      group: "outbound",
      description:
        "Numbers your app owns. Sends from anything else return 40305.",
    },
    {
      key: "messagingProfile",
      label: "Messaging profile ID",
      kind: "text",
      defaultValue: "40017f3a-5b8e-4c1d-9a7e-2f6b1c0d8e44",
      group: "outbound",
    },
    {
      key: "acceptAnyKey",
      label: "Accept any API key",
      kind: "toggle",
      defaultValue: true,
      group: "auth",
      description: "Turn off to require the key below and get real 401s.",
    },
    {
      key: "apiKey",
      label: "API key",
      kind: "secret",
      defaultValue: "KEY_local_01JC8M5QX2",
      group: "auth",
    },
    {
      key: "publicKey",
      label: "Webhook public key (Ed25519)",
      kind: "secret",
      defaultValue: "kN3p0c4lZm9yLWVtdWxhdG9yLXB1YmxpYy1rZXk=",
      group: "auth",
    },
    {
      key: "messagingUrl",
      label: "Messaging webhook URL",
      kind: "url",
      defaultValue: "http://localhost:3000/webhooks/telnyx/messaging",
      group: "inbound",
    },
    {
      key: "messagingFailoverUrl",
      label: "Messaging failover URL",
      kind: "url",
      defaultValue: "",
      group: "inbound",
      description: "Tried once when the primary URL fails, like Telnyx does.",
    },
    {
      key: "faxUrl",
      label: "Fax webhook URL",
      kind: "url",
      defaultValue: "http://localhost:3000/webhooks/telnyx/fax",
      group: "inbound",
    },
  ],
  connect: [
    {
      label: ".env",
      language: "dotenv",
      code: `TELNYX_API_KEY=KEY_local_01JC8M5QX2
TELNYX_BASE_URL=http://127.0.0.1:4102/v2
TELNYX_PUBLIC_KEY=kN3p0c4lZm9yLWVtdWxhdG9yLXB1YmxpYy1rZXk=
TELNYX_FROM_NUMBER=+16285550100`,
    },
    {
      label: "telnyx (node)",
      language: "ts",
      code: `import Telnyx from "telnyx"

const telnyx = new Telnyx({
  apiKey: process.env.TELNYX_API_KEY,
  // Point the SDK at the emulator. Unset in production.
  baseURL: process.env.TELNYX_BASE_URL,
})

await telnyx.messages.send({
  from: process.env.TELNYX_FROM_NUMBER!,
  to: "+14155550142",
  text: "Your Acme code is 731604",
})`,
    },
    {
      label: "curl",
      language: "shell",
      code: `curl -s http://127.0.0.1:4102/v2/faxes \\
  -H "Authorization: Bearer $TELNYX_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "connection_id": "local-fax-app",
    "from": "+16285550150",
    "to": "+12125550199",
    "media_url": "http://localhost:3000/files/referral.pdf"
  }'`,
    },
  ],
})
