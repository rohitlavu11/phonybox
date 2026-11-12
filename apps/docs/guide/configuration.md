# Configuration

Every flag has an environment variable. The Docker image is configured only through environment variables.

| Flag | Environment | Default | |
| --- | --- | --- | --- |
| `--host` | `PHONYBOX_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Interface to bind. |
| `--port` | `PHONYBOX_PORT` | `4100` | UI and control API. Adapters use the next ports. |
| `--mailgun-port` | `PHONYBOX_MAILGUN_PORT` | port + 1 | |
| `--telnyx-port` | `PHONYBOX_TELNYX_PORT` | port + 2 | |
| `--db` | `PHONYBOX_DB` | `:memory:` | SQLite path or `postgresql://` URL. See [Docker & databases](./docker#storage). |
| `--seed` | `PHONYBOX_SEED` | `small` | `empty`, `small` (demo story) or `large` (~3,500 inboxes). |
| `--webhook-base` | `PHONYBOX_WEBHOOK_BASE` | `http://localhost:3000` | Where your app receives webhooks. |
| `--public-host` | `PHONYBOX_PUBLIC_HOST` | bind host | Host used in URLs Phonybox hands out. |
| `--no-auto-inboxes` | `PHONYBOX_AUTO_INBOXES=0` | off | Unknown email recipients go to the catch-all. |
| `--ui` | `PHONYBOX_UI` | auto | Path to the built web app. |

`phonybox openapi` prints the control API's OpenAPI document.

## Per-adapter settings

Webhook URLs, keys, sending domain, app numbers and fault rules live on each adapter, editable under **Adapters** in the UI or with `PATCH /api/adapters/{id}`:

```sh
curl -X PATCH localhost:4100/api/adapters/telnyx -H 'content-type: application/json' \
  -d '{"values":{"failNumbers":"+12125550199","messagingUrl":"http://localhost:8080/telnyx"}}'
```

Keys and defaults: [Mailgun](/adapters/mailgun#settings), [Telnyx](/adapters/telnyx#settings).
