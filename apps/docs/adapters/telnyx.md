# Telnyx

Listens on **:4102**. Point the SDK's `baseURL` / `base_url` at `http://localhost:4102/v2`.

## Messaging

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v2/messages` | `from` (must be an app number), `to` (E.164), `text` and/or `media_urls`, `webhook_url`, `webhook_failover_url`. |
| `GET` | `/v2/messages/{id}` | Status follows the lifecycle: `queued` → `sent` → `delivered` / `delivery_failed`. |
| `GET` | `/v2/messaging_profiles` | One profile with your webhook URLs. |
| `GET` | `/v2/phone_numbers` | Your app numbers. |
| `GET` | `/v2/available_phone_numbers` | Fictional 555-01xx numbers that are free: `filter[limit]` (default 10), `filter[national_destination_code]` for an area code. US local only. |
| `POST` | `/v2/number_orders` | `phone_numbers: [{phone_number}]`. An ordered number joins `appNumbers` at once (`status: success`), so your app can text and fax from it. A number the app already has is refused with `422`. |
| `GET` | `/v2/number_orders` | The orders placed, newest first: `filter[customer_reference]`, `page[number]`, `page[size]`. |
| `GET` | `/media/{message id}/{n}` | An MMS's media, linked from the message's `media`. |

Messages are segmented the way carriers do it: GSM-7 at 160/153 characters, UCS-2 at 70/67.

Webhooks (to `messagingUrl`, or the message's `webhook_url`):

| Event | When |
| --- | --- |
| `message.sent` | ~0.5s after an outbound send |
| `message.finalized` | ~0.5s later: `delivered`, or `delivery_failed` with `errors` (40300 opted out, 40008 fault rule) |
| `message.received` | An inbox texted one of your numbers |

If the primary URL fails and `messagingFailoverUrl` is set, the same attempt goes to the failover URL.

`STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END` and `QUIT` opt the inbox out of that app number, and an automatic reply is recorded. `START`, `UNSTOP` and `YES` opt it back in.

## Fax

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/v2/faxes` | JSON or multipart. `connection_id`, `from`, `to`, and one of `media_url`, `media_name`, `contents` (upload). Returns `202`. |
| `GET` | `/v2/faxes`, `/v2/faxes/{id}` | `page[number]`, `page[size]`. |
| `DELETE` | `/v2/faxes/{id}` | `204`. |
| `GET` | `/fax-media/{id}.pdf` | The fax as PDF (uploaded, or rendered for inbound). |

Outbound lifecycle (seconds after the request): `fax.queued` (0), `fax.media.processed` (1), `fax.sending.started` (2), `fax.delivered` or `fax.failed` (5). Uploaded PDFs keep their page count. An inbox faxing your app sends `fax.received` with a `media_url`.

## Signing

Webhooks carry `telnyx-timestamp` and `telnyx-signature-ed25519 = base64(Ed25519.sign(timestamp + "|" + body))`. The public key is printed at startup and shown under **Adapters → Telnyx → Keys**. It is derived from a seed: anywhere other people can reach Phonybox, set your own with `PHONYBOX_TELNYX_KEY_SEED`, because anyone who knows the seed can sign webhooks your app will accept. The official SDKs' `webhooks.unwrap()` verifies it; that's tested nightly.

## Settings

| Key | Default | |
| --- | --- | --- |
| `appNumbers` | `+16285550100, +16285550111, +16285550150` | Numbers your app owns. |
| `messagingProfile` | `40017f3a-…` | |
| `acceptAnyKey` / `apiKey` | `true` / `KEY_local_01JC8M5QX2` | Bearer auth. |
| `publicKey` | derived | Read-only. |
| `messagingUrl` | `…/webhooks/telnyx/messaging` | |
| `messagingFailoverUrl` | empty | |
| `faxUrl` | `…/webhooks/telnyx/fax` | |
| `failNumbers` | empty | Fault rule. |
