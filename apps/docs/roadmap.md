# Roadmap

Phonybox is early. This is the rough order of work; [discussions](https://github.com/rohitlavu11/phonybox/discussions) and adapter PRs move things up.

## Shipped in 0.1

- Mailgun: messages, MIME, events, domain lookup, bounces, routes; route forwards and event webhooks
- Telnyx: SMS/MMS with segmentation and STOP/START; fax with full lifecycle and PDF media
- Signed webhooks with retries, failover and replay
- Inspector UI that scales to thousands of inboxes, light and dark
- Control API for agents: inbox per run, `wait`, extraction, send-to-app, bulk cleanup
- [MCP server](/guide/mcp), so Claude Code and other agents get inboxes, waits, codes, links and replies as tools
- SQLite and PostgreSQL; Docker image; deterministic contract suite run nightly

## Next

- **Voice**: Telnyx Call Control and TeXML, with scripted callers (DTMF, speech prompts) for testing voice agents
- **Twilio** (Messaging, Voice/TwiML)
- **Email providers**: SendGrid, Postmark, Resend, Amazon SES
- **SMTP server**, for apps that send mail directly
- Fault rule builder in the UI (latency, error rates, per-recipient rules)
- Scenario files: declarative seeds and replies (`when the app texts X, reply Y`)

## Later

- WhatsApp and RCS
- Push notifications (APNs, FCM)
- Record and replay real provider traffic into contracts
- Workspaces and auth for shared team instances
- Helm chart
- Python and TypeScript client libraries and test fixtures (pytest, Playwright, Vitest)

Want one of these? Comment on its issue, or open one. Adapters especially are designed to be [built by contributors](/adapters/build-an-adapter).
