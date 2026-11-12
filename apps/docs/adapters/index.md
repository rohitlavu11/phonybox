# Adapters

An **adapter** makes Phonybox look like one provider. Each has two halves:

- **Outbound** is the provider's REST API, the routes your app calls. Phonybox accepts the request the way the provider would, returns the provider's response shape, and drops the message into the right inbox.
- **Inbound** is what your app receives: webhooks for delivery events, and for anything an inbox sends to your app. These are signed the provider's way and retried on failure.

Each adapter listens on its own port, so SDKs that expect a host-level base URL work unchanged.

| Adapter | Port | Channels | Outbound API | Webhooks to your app |
| --- | --- | --- | --- | --- |
| [Mailgun](./mailgun) | 4101 | email | messages, messages.mime, events, domain lookup, bounces, routes | `route.forward`, `delivered`, `permanent_fail` |
| [Telnyx](./telnyx) | 4102 | SMS, MMS, fax | messages, faxes, messaging profiles, phone numbers | `message.sent`, `message.finalized`, `message.received`, `fax.*` |

## Fault rules

Each adapter can fail on purpose, so you can test the unhappy path without the real provider:

| Adapter | Setting | Effect |
| --- | --- | --- |
| Mailgun | `bounceAddresses` (globs, default `bounce@*, *+bounce@*`) | Stored as bounced; `permanent_fail` with 550 5.1.1 |
| Telnyx | `failNumbers` (E.164 list) | SMS end in `delivery_failed` (40008); faxes end in `fax.failed` (`user_busy`) |
| Telnyx | an inbox texted `STOP` | Sends from that app number fail with 40300 until `START` |
| Any | adapter switched off | API returns 503 in the provider's error shape |

## Planned

Telnyx Voice, Twilio (SMS and voice), SendGrid, Postmark, Resend, Amazon SES, Vonage and a plain SMTP server. See the [roadmap](/roadmap), or [build one](./build-an-adapter). Adapter PRs are the most welcome kind of contribution.
