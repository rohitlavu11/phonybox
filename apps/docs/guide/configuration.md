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
| `--public-url` | `PHONYBOX_PUBLIC_URL` | unset | The one URL Phonybox is reached at behind a proxy or on a single-port platform. Adapters are then `<url>/mailgun` and `<url>/telnyx`, and every URL Phonybox hands out uses it. See [In the cloud](./docker#in-the-cloud). |
| `--no-auto-inboxes` | `PHONYBOX_AUTO_INBOXES=0` | off | Unknown email recipients go to the catch-all. |
| `--ui` | `PHONYBOX_UI` | auto | Path to the built web app. |

`phonybox openapi` prints the control API's OpenAPI document.

## One port

Every adapter also answers on the control port under its id: `http://localhost:4100/mailgun/v3/…` is the same as `http://localhost:4101/v3/…`, and `http://localhost:4100/telnyx/v2/…` the same as `http://localhost:4102/v2/…`. Use it when you can expose only one port.

## Environment only

Secrets are never flags, so they don't show up in `ps`:

| Environment | |
| --- | --- |
| `PHONYBOX_ACCESS_TOKEN` | Require this token for the inspector, the control API and `/mcp`. See [In the cloud](./docker#in-the-cloud). |
| `PHONYBOX_TELNYX_KEY_SEED` | Seed for the Telnyx signing key, so it is yours and not the public default. |
| `PHONYBOX_<ADAPTER>__<SETTING>` | Hold an adapter setting fixed (note the double underscore). `PHONYBOX_MAILGUN__API_KEY` is the Mailgun adapter's `apiKey`, `PHONYBOX_TELNYX__ACCEPT_ANY_KEY=false` its `acceptAnyKey`. Applied at every start and after every reset, over what's stored. An unknown setting stops startup. |

## Per-adapter settings

Webhook URLs, keys, sending domain, app numbers and fault rules live on each adapter, editable under **Adapters** in the UI or with `PATCH /api/adapters/{id}`:

```sh
curl -X PATCH localhost:4100/api/adapters/telnyx -H 'content-type: application/json' \
  -d '{"values":{"failNumbers":"+12125550199","messagingUrl":"http://localhost:8080/telnyx"}}'
```

Keys and defaults: [Mailgun](/adapters/mailgun#settings), [Telnyx](/adapters/telnyx#settings).
