# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/rohitlavu11/phonybox/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rohitlavu11/phonybox/releases/tag/v0.1.0
