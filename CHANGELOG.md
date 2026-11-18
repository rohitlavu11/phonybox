# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-11-18

### Added

- Telnyx `GET /v2/number_orders`, with `filter[customer_reference]` and paging. Number orders are kept, so an app that looks up what it already bought before ordering (and never buys twice on a retry) works unchanged.

## [0.2.0] - 2026-11-18

### Added

- **MCP server** at `/mcp` on every Phonybox (and `phonybox mcp` over stdio), so Claude Code and other MCP clients can test an app's email, SMS and fax flows: create inboxes, wait for messages with codes and links (with link text) extracted, reply as the person, inspect and replay webhooks, see the app's provider API calls, and change provider settings. A timed-out wait explains what Phonybox did or didn't receive from the app.
- `AdapterSpec.sdk_setup`: an optional line on pointing the provider's SDK at the adapter, shown to agents by `get_setup`.
- **One port**: every adapter also answers on the control port under its id (`/mailgun`, `/telnyx`), and `PHONYBOX_PUBLIC_URL` makes every URL Phonybox hands out use one public URL, for Cloud Run and other single-port platforms. `/api/health` lists each app's URL.
- **Access token**: with `PHONYBOX_ACCESS_TOKEN` set, the inspector, control API and `/mcp` need it (Bearer, or HTTP Basic so a browser signs in with its own prompt); `/api/health` and the adapters stay as they were.
- **Settings from the environment**: `PHONYBOX_<ADAPTER>__<SETTING>` holds an adapter setting fixed (keys, domain, webhook URLs), and `PHONYBOX_TELNYX_KEY_SEED` sets your own Telnyx signing key.
- **Cloud SQL sign-in**: `?auth=gcp-iam` on a `postgresql://` URL signs in as the Google Cloud service account (IAM database authentication), and a connection the server dropped is reopened for the next statement.
- The API log keeps the newest 10,000 calls. It records refused calls too, so on a reachable Phonybox it no longer grows without bound.
- **Telnyx number search and ordering**: `GET /v2/available_phone_numbers` and `POST /v2/number_orders`; an ordered number joins `appNumbers`.

### Changed

- The inspector's **Agent access** page shows the real MCP setup for this server and the actual tools and endpoints.
- The adapters compare API keys in constant time.
- An MMS's media link is keyed by the message's UUID (`/media/{message id}/{n}`) instead of its short item id, since the link needs no credentials.

### Fixed

- `--db postgresql://…` no longer creates a stray directory named after the URL.

## [0.1.0]

First public release.

### Added

- **Mailgun adapter**: `messages` (form and MIME), events with paging, domain lookup, bounces, routes. Route-forward webhooks for inbound mail, `delivered` and `failed` event webhooks, HMAC-SHA256 signatures.
- **Telnyx adapter**: SMS and MMS with GSM-7/UCS-2 segmentation, STOP/START opt-outs, messaging profiles, phone numbers; fax with its full lifecycle and PDF media. Ed25519-signed webhooks with failover URLs.
- **Webhook delivery**: retries, failover, a per-attempt log with request and response, and replay.
- **Control API** for tests and agents: inbox per run with tags, long-polling `wait`, OTP and link extraction, sending from an inbox to your app, bulk operations by query, server-sent events.
- **Inspector**: mail, SMS and fax views, inbox directory that scales to thousands of inboxes, webhook and API logs, adapter settings. Light and dark.
- **Storage**: in memory, SQLite, or PostgreSQL.
- **Docker image** (`ghcr.io/rohitlavu11/phonybox`, amd64 and arm64) and a Compose file.
- **Deterministic contract suite** against provider JSON Schemas, golden files and the official SDKs, run on every PR and nightly.

[Unreleased]: https://github.com/rohitlavu11/phonybox/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/rohitlavu11/phonybox/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/rohitlavu11/phonybox/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/rohitlavu11/phonybox/releases/tag/v0.1.0
