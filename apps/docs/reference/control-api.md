# Control API

Base URL `http://localhost:4100/api`. Interactive docs at `/api/docs`; the OpenAPI document is at `/api/openapi.json` and is snapshotted in [`contracts/control-api.openapi.json`](https://github.com/rohitlavu11/phonybox/blob/main/contracts/control-api.openapi.json).

Fields are camelCase. Lists return `{items, total, nextCursor}`; pass `cursor` (and `limit`, max 500) to page.

## Inboxes

| Method | Path | |
| --- | --- | --- |
| `GET` | `/inboxes` | `channel`, `q` (address/label; `tag:run:42` for tags), `filter` (`all`, `unread`, `pinned`, `failing`, `idle`), `sort` (`activity`, `unread`, `name`, `created`) |
| `POST` | `/inboxes` | One `{channel, address?, label?, adapterId?, tags?}` → 201 (409 if it exists), or an array → created inboxes (existing skipped) |
| `GET` | `/inboxes/{idOrAddress}` | |
| `DELETE` | `/inboxes/{idOrAddress}` | |
| `POST` | `/inboxes/bulk` | `{op: delete|clear|read|pin|unpin, ids}` or `{op, query: {channel?, q?, filter?}, except: [ids]}` |
| `GET` | `/inboxes/{idOrAddress}/messages` | `direction`, `q`, `since`, paging |
| `GET` | `/inboxes/{idOrAddress}/wait` | `timeout`, `subject`, `direction` (default `outbound`), `since` → `{item, extract}`, or 408 |
| `POST` | `/inboxes/{idOrAddress}/send` | Email `{to?, subject, text|html}` · SMS `{appNumber?, body}` · Fax `{appNumber?, title, pages}` |
| `GET` | `/stats` | Per channel: inboxes, unread, items |

## Items

| Method | Path | |
| --- | --- | --- |
| `GET` | `/items` | `channel` (required), `inbox`, `direction`, `q`, paging |
| `GET` | `/items/{id}` | Full item, including HTML and headers |
| `PATCH` | `/items` | `{ids, read}` |
| `DELETE` | `/items/{id}` | |
| `GET` | `/items/{id}/extract` | `{codes, links}` |
| `GET` | `/items/{id}/webhooks` | Deliveries for this item |
| `GET` | `/items/{id}/request` | The API call that created it |
| `GET` | `/items/{id}/attachments/{n}` | Attachment bytes |
| `GET` | `/sms/conversations` | `inbox`, `q`, paging |
| `GET` | `/sms/conversations/{inbox}/{appNumber}` | Thread, oldest first |

## Logs, adapters, admin

| Method | Path | |
| --- | --- | --- |
| `GET` | `/webhooks` | `adapter`, `failed`, `q`, paging |
| `GET` | `/webhooks/{id}` | Full request and response |
| `POST` | `/webhooks/{id}/replay` | Re-send the recorded bytes once |
| `GET` | `/webhooks/targets`, `/webhooks/latest`, `/webhooks/failing` | |
| `GET` | `/requests`, `/requests/{id}` | API log |
| `GET` | `/adapters` | Settings per adapter |
| `PATCH` | `/adapters/{id}` | `{enabled?, values?}` |
| `POST` | `/reset` | `{dataset?: empty|small|large}` |
| `GET` | `/health` | Version, dataset, ports |
| `GET` | `/events` | Server-sent events: `change` with `{topics: [...]}` |
