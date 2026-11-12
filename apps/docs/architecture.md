# Architecture

<Architecture />

Phonybox is one Python process (FastAPI + uvicorn) serving several ports, one store, and a React inspector.

## Components

| Component | Where | Responsibility |
| --- | --- | --- |
| **Adapters** | `apps/server/src/phonybox/adapters/` | One per provider. Emulated REST API on its own port, plus builders for that provider's webhooks. Registered in `adapters/__init__.py`. |
| **Store** | `store.py`, `db.py` | Inboxes, messages, webhook and API logs, adapter settings. SQLite (default) or PostgreSQL behind one portable SQL layer. |
| **Scheduler & deliverer** | `scheduler.py` | Runs timed work off an injected clock: delayed receipts, fax lifecycles, webhook delivery and retries. Records every attempt. |
| **Control API** | `control.py`, `models.py` | `/api` for the inspector and agents, plus a server-sent events feed. Its OpenAPI document is the UI's contract. |
| **MCP server** | `mcp_server.py` | `/mcp` on the control port (and `phonybox mcp` over stdio): agent tools that wrap the control API. |
| **Inspector** | `apps/web/` | React, Vite, TanStack Query and shadcn/ui. Talks only to the control API. |
| **Contracts** | `contracts/` | Provider JSON Schemas and the control-API OpenAPI snapshot, shared by server tests and UI type checks. |

## Outbound: your app sends a text

1. Your app calls `POST /v2/messages` with the Telnyx SDK, pointed at `:4102/v2`.
2. The Telnyx adapter validates it like Telnyx does (E.164, owned `from`, opt-outs), stores the message in the recipient's inbox (`inbox_for` creates one if needed), records the call in the API log, and returns Telnyx's response.
3. The scheduler fires `message.sent` and then `message.finalized`. Each is signed with Ed25519 and POSTed to your messaging URL, retried on failure.
4. Every write publishes a change event. The inspector and any long-polling agent see the new message immediately.

## Inbound: an inbox replies

1. The inspector or an agent calls `POST /api/inboxes/{inbox}/send`.
2. The control API hands it to the inbox's adapter (`AdapterSpec.send_to_app`), which stores the message and enqueues the provider's inbound webhook: `message.received`, Mailgun `route.forward` or `fax.received`.
3. If your app answers non-2xx, the attempt is recorded and retried. The inbox is marked failing until a later attempt succeeds.

## Data model

| Table | Holds |
| --- | --- |
| `inboxes` | Address, channel, adapter, tags, pinned, plus counters kept on write: messages, unread, last activity, failing webhooks. |
| `items` | Every email, SMS and fax. List fields in `data`; heavy fields (HTML, headers) in `heavy`, loaded only when opened. |
| `webhooks`, `chains` | Every delivery attempt. `chains` keeps the latest status per (item, event), which drives "failing". |
| `requests` | API calls your app made. |
| `adapters` | Enabled flag and settings per adapter. |

Lists are paged with a cursor and a total; search, filters and sorts run in SQL; per-inbox counters are maintained on write. Listing 5,000 inboxes never reads a message.

## Determinism

Nothing reads the wall clock or a random source directly. Time comes from a `Clock`, and IDs, tokens and keys from a seeded `Ids`. In tests the clock is frozen and only moves with `emu.advance(seconds)`, so a three-attempt retry schedule takes zero real time and produces the same bytes on every run, on either database. The contract suite asserts exactly that.

## Repository layout

```
apps/
  server/   Python package `phonybox` (uv), tests/contract + tests/live
  web/      inspector (React + Vite + shadcn/ui)
  docs/     this site (VitePress)
contracts/  provider schemas + control-API snapshot
examples/   runnable agent-flow scripts
```
