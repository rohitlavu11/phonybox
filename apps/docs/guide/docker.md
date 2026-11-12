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
