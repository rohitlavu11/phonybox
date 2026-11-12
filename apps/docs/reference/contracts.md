# Contracts & testing

Phonybox is only useful if it behaves like the real providers. That's enforced by a deterministic contract suite that runs on every PR and every night.

## What's checked

| Contract | How |
| --- | --- |
| **Provider APIs** | Every emulated endpoint and error is validated against JSON Schemas in `contracts/providers/`, written from Mailgun's and Telnyx's documentation. |
| **Webhooks** | Bodies are schema-checked; signatures are verified with independent implementations (HMAC, Ed25519); retries, failover and replay are driven by a frozen clock. Key payloads are compared byte for byte with golden files. |
| **Determinism** | Two identical runs produce identical database state and webhook bytes; the load-test seed is a pure function of its seed. |
| **Server ↔ UI** | The control API's OpenAPI document is snapshotted. The UI's TypeScript types are generated from it, and a compile-time check fails if any response stops fitting the UI's types. |
| **Official SDKs** | `telnyx` and `mailgun` drive Phonybox over real sockets; Telnyx's `webhooks.unwrap()` verifies Phonybox's signatures. Nightly runs also test the latest SDK releases to catch upstream drift. |
| **Both databases** | The whole suite runs against SQLite and PostgreSQL and must match the same golden files. |

## Running it

```sh
cd apps/server
uv run pytest                     # everything, SQLite
uv run pytest tests/contract      # deterministic only
uv run pytest tests/live          # sockets + SDKs

# against PostgreSQL (each test gets its own schema, dropped afterwards)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
PHONYBOX_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres uv run pytest

# accept an intended change to golden files or the OpenAPI snapshot
uv run pytest --update-golden
pnpm contract                     # refresh the snapshot and regenerate UI types
```

## How determinism works

- `FrozenClock`: time moves only when a test calls `emu.advance(seconds)`. Retries (2s, 10s) and fax steps run instantly, in order.
- `Ids(seed=1)`: every ID, token and Message-Id is derived from a counter.
- The Telnyx signing key is derived from a fixed seed; Ed25519 signatures are deterministic.
- Webhooks reach an in-process `FakeApp` through an httpx `MockTransport` that answers with scripted statuses. No sockets, no sleeps.

The nightly workflow is [`.github/workflows/contracts.yml`](https://github.com/rohitlavu11/phonybox/blob/main/.github/workflows/contracts.yml). A failed nightly run opens an issue.
