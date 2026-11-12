# Getting started

## Run it

::: code-group

```sh [Docker]
docker run --rm -p 4100-4102:4100-4102 ghcr.io/rohitlavu11/phonybox
```

```sh [From source]
git clone https://github.com/rohitlavu11/phonybox && cd phonybox
pnpm install && pnpm start        # needs Node 22+, pnpm and uv
```

```sh [Docker Compose]
curl -O https://raw.githubusercontent.com/rohitlavu11/phonybox/main/docker-compose.yml
docker compose up
```

:::

You get three servers:

| Port | What |
| --- | --- |
| `4100` | Inspector UI and the control API (`/api`, docs at `/api/docs`) |
| `4101` | Mailgun API |
| `4102` | Telnyx API (`/v2`) |

Open [http://localhost:4100](http://localhost:4100). The small demo seed is loaded so there's something to look at. Start empty with `PHONYBOX_SEED=empty`, or load ~3,500 inboxes with `PHONYBOX_SEED=large`.

## Send your first message

```sh
curl -s --user api:anything http://localhost:4101/v3/mg.acme.test/messages \
  -F from="Acme <noreply@mg.acme.test>" \
  -F to=alice@inbox.test \
  -F subject="Your code" \
  -F text="Your verification code is 482 913"
```

`alice@inbox.test` didn't exist, so Phonybox created an inbox for it. Read it back like an agent would:

```sh
curl -s "http://localhost:4100/api/inboxes/alice@inbox.test/wait?timeout=10" | jq .extract
# { "codes": ["482913"], "links": [] }
```

And a text, through the Telnyx API:

```sh
curl -s http://localhost:4102/v2/messages -H "Authorization: Bearer anything" \
  -H "content-type: application/json" \
  -d '{"from":"+16285550100","to":"+14155550100","text":"Your code is 731604"}'
```

## Next

- [Connect your app](./connect-your-app): point the SDKs at Phonybox and receive webhooks.
- [Testing AI agents](./testing-agents): the inbox-per-run pattern.
- [Docker & databases](./docker): Compose, PostgreSQL and networking.
