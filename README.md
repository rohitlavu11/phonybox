<div align="center">

<img src=".github/assets/logo.svg" width="72" height="72" alt="">

# Phonybox

**Phony numbers. Real webhooks.**

A local emulator for Mailgun and Telnyx. Your app keeps its SDKs, every email, text and fax lands in an inbox you can see,<br>
and replies come back as real, signed webhooks. Built for testing apps and the AI agents that use them.

[![CI](https://github.com/rohitlavu11/phonybox/actions/workflows/ci.yml/badge.svg)](https://github.com/rohitlavu11/phonybox/actions/workflows/ci.yml)
[![Contracts](https://github.com/rohitlavu11/phonybox/actions/workflows/contracts.yml/badge.svg)](https://github.com/rohitlavu11/phonybox/actions/workflows/contracts.yml)
[![Docs](https://img.shields.io/badge/docs-rohitlavu11.github.io%2Fphonybox-e0602a)](https://rohitlavu11.github.io/phonybox/)
[![License](https://img.shields.io/badge/license-Apache--2.0-24211d)](LICENSE)

[Docs](https://rohitlavu11.github.io/phonybox/) · [Getting started](https://rohitlavu11.github.io/phonybox/guide/getting-started) · [Testing agents](https://rohitlavu11.github.io/phonybox/guide/testing-agents) · [Build an adapter](https://rohitlavu11.github.io/phonybox/adapters/build-an-adapter) · [Roadmap](#roadmap)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="apps/docs/public/screenshots/mail-dark.png">
  <img src="apps/docs/public/screenshots/mail-light.png" alt="The Phonybox inspector showing a mail inbox with a verification email open" width="920">
</picture>

</div>

## Why

Apps that send email and texts are awkward to test. Real providers cost money, need real numbers and domains, rate-limit you, and can't make a handset reply `STOP` on cue. Mocking the SDK skips exactly the parts that break: webhook signatures, retries, delivery receipts, opt-outs, bounces.

It gets worse with agents. A browser agent that signs up for your product needs the verification code. A support agent that texts customers needs someone to text back. Run twenty of them in parallel and they all need their own inbox.

Phonybox stands in for the provider. It speaks the provider's real HTTP API on a local port, stores what your app sends, and calls your app back exactly like the provider would.

```
your app ──(mailgun.js, telnyx SDK)──▶ Phonybox ──▶ inbox you can see, and an agent can read
your app ◀──(signed webhooks)───────── Phonybox ◀── a reply from that inbox
```

## Features

- **Drop-in for your SDKs.** Change the base URL and nothing else. Verified against the official `telnyx` and `mailgun` SDKs.
- **Email, SMS/MMS and fax.** Mailgun messages, MIME, events, routes and bounces. Telnyx messaging with segmentation, STOP/START, MMS media, and fax with its full `queued → media.processed → sending → delivered` lifecycle.
- **Real webhooks.** Signed with HMAC (Mailgun) and Ed25519 (Telnyx), retried on failure, with failover URLs, a delivery log and one-click replay.
- **Made for agents.** An inbox per run, a long-polling `wait` endpoint, OTP and link extraction, sending as the human, and cleanup by tag.
- **An inspector that scales.** A mail client, an SMS thread view and a fax viewer that stay fast at thousands of inboxes. Light and dark.
- **The hard cases on demand.** Opt-outs, bounces, busy fax lines, undeliverable numbers, your own handler returning 500.
- **Deterministic.** An injectable clock and seeded IDs. The contract suite produces identical bytes on every run, on SQLite and PostgreSQL.
- **Adapters, not a monolith.** Each provider is one Python module. [Adding one](https://rohitlavu11.github.io/phonybox/adapters/build-an-adapter) touches no other code.

## Quick start

```sh
docker run --rm -p 4100-4102:4100-4102 ghcr.io/rohitlavu11/phonybox
```

| Port | What |
| --- | --- |
| `4100` | Inspector UI and control API (`/api`, OpenAPI docs at `/api/docs`) |
| `4101` | Mailgun API |
| `4102` | Telnyx API (`/v2`) |

Send an email the way your app would, then read it back the way an agent would:

```sh
curl -s --user api:anything http://localhost:4101/v3/mg.acme.test/messages \
  -F from="Acme <noreply@mg.acme.test>" -F to=alice@inbox.test \
  -F subject="Your code" -F text="Your verification code is 482 913"

curl -s "http://localhost:4100/api/inboxes/alice@inbox.test/wait?timeout=10" | jq .extract
# { "codes": ["482913"], "links": [] }
```

<details>
<summary><b>From source</b></summary>

Needs Node 22+, [pnpm](https://pnpm.io) and [uv](https://docs.astral.sh/uv/).

```sh
git clone https://github.com/rohitlavu11/phonybox && cd phonybox
pnpm install
pnpm start                         # builds the inspector and serves everything on 4100-4102
```

Or run just the server: `cd apps/server && uv run phonybox --seed empty`.

</details>

<details>
<summary><b>Keep state, or use PostgreSQL</b></summary>

State is in memory by default. Keep it in SQLite or PostgreSQL:

```sh
docker run -p 4100-4102:4100-4102 -v phonybox:/data -e PHONYBOX_DB=/data/phonybox.db ghcr.io/rohitlavu11/phonybox
docker run -p 4100-4102:4100-4102 -e PHONYBOX_DB=postgresql://user:pass@db:5432/phonybox ghcr.io/rohitlavu11/phonybox
```

[`docker-compose.yml`](docker-compose.yml) runs either one. With Postgres:

```sh
PHONYBOX_DB=postgresql://phonybox:phonybox@postgres:5432/phonybox docker compose --profile postgres up
```

</details>

## Connect your app

Point the SDK's base URL at Phonybox. Any API key works.

```ts
const mg = new Mailgun(formData).client({ username: "api", key, url: "http://localhost:4101" })
const telnyx = new Telnyx({ apiKey, baseURL: "http://localhost:4102/v2" })
```

Webhooks go to `http://localhost:3000` by default, on the paths you'd configure in each provider's dashboard. Change them per adapter in the UI, or set `PHONYBOX_WEBHOOK_BASE` (in Docker, `http://host.docker.internal:3000`). Telnyx webhooks are signed with a local key, shown under **Adapters → Telnyx → Keys**, so `telnyx.webhooks.unwrap()` works unchanged.

More: [Connect your app](https://rohitlavu11.github.io/phonybox/guide/connect-your-app).

## Testing agents

Give each run its own inbox, let the agent work, wait for what it should have received, reply as the human, and clean up.

```python
import httpx

API = "http://localhost:4100/api"

inbox = httpx.post(f"{API}/inboxes", json={"channel": "sms", "tags": ["run:42"]}).json()["address"]

agent.run(f"Turn on two-factor auth for the account, using the phone number {inbox}")

msg = httpx.get(f"{API}/inboxes/{inbox}/wait", params={"timeout": 30}, timeout=35).json()
code = msg["extract"]["codes"][0]                     # the OTP your app texted

httpx.post(f"{API}/inboxes/{inbox}/send", json={"body": "STOP"})   # your app gets message.received
httpx.post(f"{API}/inboxes/bulk", json={"op": "delete", "query": {"q": "tag:run:42"}, "except": []})
```

Runnable versions are in [`examples/`](examples). The full pattern, with pytest and Node fixtures, is in [Testing AI agents](https://rohitlavu11.github.io/phonybox/guide/testing-agents).

<table>
  <tr>
    <td width="50%"><img src="apps/docs/public/screenshots/sms-light.png" alt="SMS threads between app numbers and an inbox"></td>
    <td width="50%"><img src="apps/docs/public/screenshots/webhooks-light.png" alt="Webhook delivery log with a failed delivery and its retries"></td>
  </tr>
  <tr>
    <td align="center"><sub>SMS threads, with delivery status per message</sub></td>
    <td align="center"><sub>Every webhook attempt, request and response. Replay with one click.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="apps/docs/public/screenshots/inboxes-light.png" alt="Inbox directory with thousands of inboxes, filters and bulk actions"></td>
    <td width="50%"><img src="apps/docs/public/screenshots/fax-light.png" alt="Fax viewer with pages and the fax lifecycle"></td>
  </tr>
  <tr>
    <td align="center"><sub>Thousands of inboxes: search, tags, bulk actions</sub></td>
    <td align="center"><sub>Faxes, page by page, with their lifecycle</sub></td>
  </tr>
</table>

## Providers

| Provider | Channels | Emulated | Webhooks |
| --- | --- | --- | --- |
| [Mailgun](https://rohitlavu11.github.io/phonybox/adapters/mailgun) | Email | Messages (form + MIME), events, domain lookup, bounces, routes | Route forwards, `delivered`, `failed`; HMAC-SHA256 |
| [Telnyx](https://rohitlavu11.github.io/phonybox/adapters/telnyx) | SMS, MMS, fax | Messages, messaging profiles, phone numbers, faxes, media | `message.sent`, `message.finalized`, `message.received`, `fax.*`; Ed25519 |

Want another? See the [roadmap](#roadmap), or [build an adapter](https://rohitlavu11.github.io/phonybox/adapters/build-an-adapter): one module with an `AdapterSpec`, no changes elsewhere.

## Architecture

```mermaid
flowchart LR
  app["Your app<br/><sub>unchanged SDKs</sub>"]
  subgraph phonybox["Phonybox (one process)"]
    mg["Mailgun adapter<br/><sub>:4101</sub>"]
    tx["Telnyx adapter<br/><sub>:4102/v2</sub>"]
    store[("Store<br/><sub>SQLite or PostgreSQL</sub>")]
    sched["Scheduler<br/><sub>retries, fax lifecycle</sub>"]
    api["Control API<br/><sub>:4100/api, SSE</sub>"]
  end
  ui["Inspector"]
  agents["Agents and tests"]

  app -- API calls --> mg
  app -- API calls --> tx
  mg --> store
  tx --> store
  store --> sched
  sched -. signed webhooks .-> app
  store <--> api
  api --> ui
  api <--> agents
```

One Python process (FastAPI + uvicorn) serves the adapters and the control API. Adapters validate requests like the real provider, write to the store, and queue webhooks. The scheduler delivers them off an injectable clock, so tests can fast-forward through retries. The inspector is a React app that talks only to the control API, whose OpenAPI document is snapshotted and type-checked against the UI in CI.

| Path | |
| --- | --- |
| [`apps/server`](apps/server) | Python package `phonybox`: adapters, store, scheduler, control API, contract tests |
| [`apps/web`](apps/web) | Inspector (React, Vite, TanStack Query, shadcn/ui) |
| [`apps/docs`](apps/docs) | Documentation site (VitePress) |
| [`contracts`](contracts) | Provider JSON Schemas and the control-API OpenAPI snapshot |
| [`examples`](examples) | Runnable agent-flow scripts |

Details: [Architecture](https://rohitlavu11.github.io/phonybox/architecture).

## Contract tests

Phonybox is only useful if it behaves like the real thing. Every PR and every night, a deterministic suite checks provider responses and webhooks against JSON Schemas written from the providers' docs, verifies signatures with independent implementations, compares key payloads byte for byte with golden files, and drives Phonybox with the official SDKs over real sockets. It runs on SQLite and PostgreSQL. Nightly runs also test the latest SDK releases, so upstream drift opens an issue instead of surprising you.

```sh
cd apps/server && uv run pytest
```

[More on contracts](https://rohitlavu11.github.io/phonybox/reference/contracts).

## Roadmap

- [x] Mailgun: email, MIME, events, routes, bounces
- [x] Telnyx: SMS/MMS and fax
- [x] Signed webhooks with retries, failover and replay
- [x] Control API for agents; inspector that scales to thousands of inboxes
- [x] SQLite and PostgreSQL; Docker image; nightly contract suite
- [ ] MCP server: `create_inbox`, `wait_for_message`, `extract`, `send_to_app` as agent tools
- [ ] Voice: Telnyx Call Control and TeXML, with scripted callers for voice agents
- [ ] Twilio (Messaging, Voice)
- [ ] SendGrid, Postmark, Resend, Amazon SES
- [ ] SMTP server
- [ ] Fault rules in the UI (latency, error rates, per-recipient)
- [ ] Scenario files: declarative seeds and auto-replies
- [ ] WhatsApp and RCS

The full list, with what comes later, is on the [roadmap page](https://rohitlavu11.github.io/phonybox/roadmap).

## Contributing

Issues and PRs are welcome, adapters especially. Start with [CONTRIBUTING.md](CONTRIBUTING.md); the short version:

```sh
pnpm install && (cd apps/server && uv sync --all-groups)
pnpm dev        # server on 4100-4102, inspector with hot reload on 5173
pnpm test       # server suite + UI type contract
pnpm docs       # docs site
```

## Security

Phonybox is a test tool. It accepts any API key by default and has no user accounts, so don't expose it to the internet or point real customer data at it. See [SECURITY.md](SECURITY.md).

## Acknowledgements

Inspired by [vercel-labs/emulate](https://github.com/vercel-labs/emulate), which does this for developer APIs, and by [Mailpit](https://github.com/axllent/mailpit) and [MailHog](https://github.com/mailhog/MailHog), which did it for SMTP. Not affiliated with Mailgun or Telnyx; the names are used only to describe compatibility.

## License

[Apache-2.0](LICENSE)
