# Why Phonybox

AI agents increasingly pick up the phone: they send verification codes, answer support texts, fax forms to clinics and reply to email threads. Testing them against real providers is slow, costs money, needs real numbers and addresses, and can't easily reproduce the failures that matter.

Phonybox gives your app and your agents a **local, stateful copy of the providers you already use**:

- **Your app doesn't change.** It keeps using the official Mailgun and Telnyx SDKs. You change one base URL.
- **Messages land in inboxes, not in someone's phone.** Every email, SMS, MMS and fax your app sends is captured in an inbox you can inspect in the UI or read over HTTP.
- **Your app still receives real webhooks.** When an inbox replies, or a message is delivered, Phonybox POSTs the same payload the provider would, signed the same way, with the same retries.
- **Agents get a test harness.** Create an inbox per run, block until a message arrives, pull out the code or link, reply, then clean up by tag.

## What it is not

Phonybox is a test double. It doesn't send anything to the outside world, it isn't a production mail server, and it should never be exposed to the internet. See [SECURITY.md](https://github.com/rohitlavu11/phonybox/blob/main/SECURITY.md).

## Compared with

| | Phonybox | Real provider sandbox | Mock library | Mailpit / MailHog |
| --- | --- | --- | --- | --- |
| Uses your real SDK and HTTP calls | ✓ | ✓ | ✗ | SMTP only |
| SMS, MMS and fax | ✓ | ✓ | depends | ✗ |
| Inbound webhooks to your app, signed | ✓ | ✓ | ✗ | ✗ |
| Inspectable inboxes and webhook log | ✓ | partial | ✗ | email only |
| Inject failures (bounces, opt-outs, 500s) | ✓ | hard | manual | ✗ |
| Works offline, free, deterministic | ✓ | ✗ | ✓ | ✓ |

Phonybox started from the same idea as [vercel-labs/emulate](https://github.com/vercel-labs/emulate), which does this for auth and cloud APIs. Phonybox focuses on communications.
