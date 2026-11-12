import { defineAdapter } from "./define"

export const mailgun = defineAdapter({
  id: "mailgun",
  name: "Mailgun",
  monogram: "Mg",
  description:
    "Messages API, events and inbound routes. Signs webhooks with HMAC-SHA256 the same way Mailgun does.",
  channels: ["email"],
  port: 4101,
  apiPrefix: "",
  version: "0.1.0",
  docsUrl: "https://documentation.mailgun.com/docs/mailgun/api-reference/",
  outbound: [
    {
      method: "POST",
      path: "/v3/{domain}/messages",
      summary: "Send a message",
      channel: "email",
      support: "full",
    },
    {
      method: "POST",
      path: "/v3/{domain}/messages.mime",
      summary: "Send a raw MIME message",
      channel: "email",
      support: "partial",
    },
    {
      method: "GET",
      path: "/v3/{domain}/events",
      summary: "Query the event log",
      channel: "email",
      support: "full",
    },
    {
      method: "GET",
      path: "/v3/domains/{domain}",
      summary: "Get domain details",
      channel: "email",
      support: "partial",
    },
    {
      method: "GET",
      path: "/v3/{domain}/bounces",
      summary: "List bounces",
      channel: "email",
      support: "partial",
    },
    {
      method: "POST",
      path: "/v3/routes",
      summary: "Create an inbound route",
      channel: "email",
      support: "partial",
    },
    {
      method: "GET",
      path: "/v3/domains/{domain}/messages/{key}",
      summary: "Retrieve a stored message",
      channel: "email",
      support: "planned",
    },
    {
      method: "GET",
      path: "/v4/address/validate",
      summary: "Validate an address",
      channel: "email",
      support: "planned",
    },
  ],
  inbound: [
    {
      event: "route.forward",
      channel: "email",
      trigger: "An inbox sends mail to a route address",
      urlSetting: "routeUrl",
    },
    {
      event: "delivered",
      channel: "email",
      trigger: "An outbound message lands in an inbox",
      urlSetting: "eventsUrl",
    },
    {
      event: "permanent_fail",
      channel: "email",
      trigger: "A fault rule bounces a message",
      urlSetting: "eventsUrl",
    },
    {
      event: "temporary_fail",
      channel: "email",
      trigger: "A fault rule defers a message",
      urlSetting: "eventsUrl",
    },
    {
      event: "opened",
      channel: "email",
      trigger: "A message is opened in the inbox viewer",
      urlSetting: "eventsUrl",
    },
    {
      event: "clicked",
      channel: "email",
      trigger: "A tracked link is opened from the viewer",
      urlSetting: "eventsUrl",
    },
  ],
  settings: [
    {
      key: "bounceAddresses",
      label: "Bounce these recipients",
      kind: "text",
      defaultValue: "bounce@*, *+bounce@*",
      group: "outbound",
      description:
        "Comma-separated globs. Matching mail is stored as bounced and your app gets permanent_fail (550 5.1.1).",
    },
    {
      key: "domain",
      label: "Sending domain",
      kind: "text",
      defaultValue: "mg.acme.test",
      group: "outbound",
      description:
        "Requests to other domains return 404, like an unverified domain would.",
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
      defaultValue: "key-local-7c1e0a4b9d",
      group: "auth",
    },
    {
      key: "signingKey",
      label: "Webhook signing key",
      kind: "secret",
      defaultValue: "whsk-local-mg-3f9a21",
      group: "auth",
    },
    {
      key: "routeUrl",
      label: "Inbound route URL",
      kind: "url",
      defaultValue: "http://localhost:3000/webhooks/mailgun/inbound",
      group: "inbound",
      description: "Receives forwarded mail as multipart/form-data.",
    },
    {
      key: "routeMatch",
      label: "Route expression",
      kind: "text",
      defaultValue: 'match_recipient(".*@mg.acme.test")',
      group: "inbound",
    },
    {
      key: "eventsUrl",
      label: "Event webhook URL",
      kind: "url",
      defaultValue: "http://localhost:3000/webhooks/mailgun/events",
      group: "inbound",
      description:
        "delivered, permanent_fail, temporary_fail, opened, clicked.",
    },
  ],
  connect: [
    {
      label: ".env",
      language: "dotenv",
      code: `MAILGUN_API_KEY=key-local-7c1e0a4b9d
MAILGUN_DOMAIN=mg.acme.test
MAILGUN_URL=http://127.0.0.1:4101
MAILGUN_WEBHOOK_SIGNING_KEY=whsk-local-mg-3f9a21`,
    },
    {
      label: "mailgun.js",
      language: "ts",
      code: `import formData from "form-data"
import Mailgun from "mailgun.js"

const mg = new Mailgun(formData).client({
  username: "api",
  key: process.env.MAILGUN_API_KEY!,
  // Point the SDK at the emulator. Unset in production.
  url: process.env.MAILGUN_URL,
})

await mg.messages.create(process.env.MAILGUN_DOMAIN!, {
  from: "Acme <noreply@mg.acme.test>",
  to: ["agent-1@inbox.test"],
  subject: "Confirm your email address",
  text: "Your code is 482913",
})`,
    },
    {
      label: "curl",
      language: "shell",
      code: `curl -s --user "api:$MAILGUN_API_KEY" \\
  http://127.0.0.1:4101/v3/mg.acme.test/messages \\
  -F from="Acme <noreply@mg.acme.test>" \\
  -F to=agent-1@inbox.test \\
  -F subject="Hello" \\
  -F text="Sent to the local emulator"`,
    },
  ],
})
