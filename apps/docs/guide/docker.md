# Docker & databases

## The image

```sh
docker run --rm -p 4100-4102:4100-4102 ghcr.io/rohitlavu11/phonybox
```

Multi-arch (`linux/amd64`, `linux/arm64`), runs as a non-root user, and has a healthcheck on `/api/health`. Build it yourself with `docker build -t phonybox .` from the repo root.

## Reaching your app

Inside the container, `localhost` is the container. Tell Phonybox where your app listens:

```sh
docker run --rm -p 4100-4102:4100-4102 \
  --add-host host.docker.internal:host-gateway \
  -e PHONYBOX_WEBHOOK_BASE=http://host.docker.internal:3000 \
  ghcr.io/rohitlavu11/phonybox
```

`http://host.docker.internal:3000` is already the image's default. Docker Desktop resolves it out of the box; on Linux, keep the `--add-host` flag. If your app runs in Compose, use its service name: `PHONYBOX_WEBHOOK_BASE=http://web:3000`.

URLs Phonybox hands out (MMS media, fax PDFs, Mailgun paging) use `127.0.0.1` by default. If another container needs to fetch them, set `PHONYBOX_PUBLIC_HOST=phonybox`.

## Storage

| `PHONYBOX_DB` | Behaviour |
| --- | --- |
| `:memory:` (default) | SQLite in memory. Fresh on every start, which is what most test runs want. |
| `/data/phonybox.db` | SQLite file. Mount a volume at `/data` to keep it. |
| `postgresql://user:pw@host:5432/db` | PostgreSQL. State survives restarts and can be shared by a team. Add `?schema=phonybox` to keep its tables out of your app's schema. |
| `postgresql://<sa>%40<project>.iam@<ip>:5432/db?sslmode=require&auth=gcp-iam` | Cloud SQL with IAM database authentication: Phonybox signs in as the service account it runs as (the account's email without `.gserviceaccount.com`, `@` encoded as `%40`), with its access token from the metadata server as the password. No password to store. |

If the server drops the connection (a restart, a failover, maintenance), the statement that hit it fails and the next one opens a new connection.

Both backends run the same contract suite in CI, so behaviour is identical.

## Compose

```yaml
services:
  phonybox:
    image: ghcr.io/rohitlavu11/phonybox:latest
    ports: ["4100:4100", "4101:4101", "4102:4102"]
    environment:
      PHONYBOX_WEBHOOK_BASE: http://web:3000
      PHONYBOX_DB: postgresql://phonybox:phonybox@postgres:5432/phonybox
    depends_on:
      postgres: { condition: service_healthy }

  postgres:
    image: postgres:17
    environment: { POSTGRES_USER: phonybox, POSTGRES_PASSWORD: phonybox, POSTGRES_DB: phonybox }
    healthcheck: { test: ["CMD", "pg_isready", "-U", "phonybox"], interval: 2s, retries: 30 }

  web:
    build: .
    environment:
      MAILGUN_URL: http://phonybox:4101
      TELNYX_BASE_URL: http://phonybox:4102/v2
```

The repo's [`docker-compose.yml`](https://github.com/rohitlavu11/phonybox/blob/main/docker-compose.yml) runs Phonybox alone, or with PostgreSQL behind the `postgres` profile:

```sh
docker compose up        # SQLite in memory
PHONYBOX_DB=postgresql://phonybox:phonybox@postgres:5432/phonybox docker compose --profile postgres up
```

## In the cloud

On a platform that serves one port (Cloud Run, Fly, Render, a single load balancer route), give Phonybox the URL it is reached at, an access token, and real keys:

```sh
docker run -p 4100:4100 \
  -e PHONYBOX_PUBLIC_URL=https://phonybox.example.com \
  -e PHONYBOX_ACCESS_TOKEN="$(openssl rand -hex 32)" \
  -e PHONYBOX_TELNYX_KEY_SEED="$(openssl rand -hex 32)" \
  -e PHONYBOX_MAILGUN__API_KEY=… -e PHONYBOX_MAILGUN__ACCEPT_ANY_KEY=false \
  -e PHONYBOX_TELNYX__API_KEY=… -e PHONYBOX_TELNYX__ACCEPT_ANY_KEY=false \
  -e PHONYBOX_MAILGUN__SIGNING_KEY=… \
  -e PHONYBOX_WEBHOOK_BASE=https://app.example.com \
  -e PHONYBOX_DB=postgresql://… -e PHONYBOX_SEED=empty \
  ghcr.io/rohitlavu11/phonybox
```

- **Your app** uses `https://phonybox.example.com/mailgun` as its Mailgun URL and `https://phonybox.example.com/telnyx/v2` as its Telnyx base URL, with the keys above. The adapters check the providers' own credentials and never need the access token.
- **People** open `https://phonybox.example.com`. The browser asks for a username and password: any username, and the access token as the password. Your password manager can keep it.
- **Scripts and agents** send `Authorization: Bearer <token>` to the control API and `/mcp` ([MCP](./mcp#connect)).
- `/api/health` stays open for the platform's health check.

Run one instance with CPU always on: webhook retries and fax lifecycles run in the background between requests. Keep state in PostgreSQL, so a restart or redeploy keeps every inbox and the numbers your app ordered. On Cloud Run with Cloud SQL, `?auth=gcp-iam` ([Storage](#storage)) needs no password and no proxy.

## In CI

```yaml
# GitHub Actions
services:
  phonybox:
    image: ghcr.io/rohitlavu11/phonybox:latest
    ports: ["4100:4100", "4101:4101", "4102:4102"]
    env:
      PHONYBOX_SEED: empty
```
