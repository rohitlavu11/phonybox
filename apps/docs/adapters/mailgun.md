# Mailgun

Listens on **:4101**. Point `mailgun.js` (`url`) or the Python SDK (`api_url`) at `http://localhost:4101`.

## Emulated endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v3/{domain}/messages` | `from`, `to`/`cc`/`bcc` (repeatable), `subject`, `text`, `html`, `attachment`, `inline`, `o:tag`, `h:*`, `v:*`. One copy per recipient inbox, one Message-Id. |
| `POST` | `/v3/{domain}/messages.mime` | `to` plus a `message` file (RFC 822). |
| `GET` | `/v3/{domain}/events` | `event`, `recipient`, `limit`, `ascending`; paging links follow Mailgun's `/events/{page}` form. |
| `GET` | `/v3/domains/{domain}` | Domain record, always `active`. |
| `GET` | `/v3/{domain}/bounces` | Recipients that hit a bounce rule. |
| `POST`, `GET` | `/v3/routes` | `expression` (`match_recipient("…")`, `catch_all()`), `action` (`forward("url")`, `stop()`), `priority`. |

Responses and errors match Mailgun: `{"id": "<…@domain>", "message": "Queued. Thank you."}` on success; `401 Forbidden`, `404 {"message": "Domain not found: …"}`, `400 {"message": "to parameter is missing"}` and friends. Unknown routes return `404` JSON.

## Webhooks

| Event | When | Body |
| --- | --- | --- |
| `delivered` | ~0.5s after an outbound send | JSON `{"signature": {...}, "event-data": {...}}` |
| `permanent_fail` | A bounce rule matched | Same envelope; `event-data.event = "failed"`, `severity = "permanent"`, code 550 |
| `route.forward` | An inbox emailed an address matching a route | `multipart/form-data`: `recipient`, `sender`, `body-plain`, `stripped-text`, `message-headers`, `timestamp`, `token`, `signature`… |

Every webhook is signed: `signature = hex(HMAC-SHA256(signingKey, timestamp + token))`.

## Settings

| Key | Default | |
| --- | --- | --- |
| `domain` | `mg.acme.test` | Sending domain. Others return 404. |
| `acceptAnyKey` | `true` | Off: only `apiKey` is accepted. |
| `apiKey` | `key-local-7c1e0a4b9d` | |
| `signingKey` | `whsk-local-mg-3f9a21` | HTTP webhook signing key. |
| `routeUrl` | `…/webhooks/mailgun/inbound` | Built-in route target. |
| `routeMatch` | `match_recipient(".*@mg.acme.test")` | Which recipients the built-in route forwards. |
| `eventsUrl` | `…/webhooks/mailgun/events` | Event webhooks. Empty to disable. |
| `bounceAddresses` | `bounce@*, *+bounce@*` | Fault rule. |
