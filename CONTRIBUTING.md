# Contributing to Phonybox

Thanks for helping. Bug reports, missing endpoints, new adapters and docs fixes are all welcome.

## Setup

You need Node 22+, [pnpm](https://pnpm.io) 10 and [uv](https://docs.astral.sh/uv/).

```sh
git clone https://github.com/rohitlavu11/phonybox && cd phonybox
pnpm install
(cd apps/server && uv sync --all-groups)
pnpm dev
```

`pnpm dev` runs the server on 4100-4102 and the inspector with hot reload on http://localhost:5173 (it proxies `/api`). `pnpm dev:mock` runs the inspector against an in-browser mock, with no server.

## Layout

| Path | |
| --- | --- |
| `apps/server` | Python package `phonybox`: adapters, store, scheduler, control API, tests |
| `apps/web` | Inspector (React, Vite, TanStack Query, shadcn/ui) |
| `apps/docs` | Docs site (VitePress), published to GitHub Pages |
| `contracts` | Provider JSON Schemas and the control-API OpenAPI snapshot |
| `examples` | Runnable agent-flow scripts |

## Checks

Run these before opening a PR. CI runs the same ones.

```sh
cd apps/server
uv run pytest              # contract + live tests, SQLite
uv run ruff check
cd ../..
pnpm contract              # regenerate the OpenAPI snapshot + UI types, type-check the UI
pnpm --filter @phonybox/web lint
pnpm --filter @phonybox/web build
```

Against PostgreSQL:

```sh
docker run -d --name phonybox-pg -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:17
PHONYBOX_TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres uv run pytest
```

## Contracts and golden files

The suite is deterministic: a frozen clock, seeded IDs, no sleeps. If a test is flaky, that's a bug.

- **Changed a webhook payload or response on purpose?** Run `uv run pytest --update-golden` and commit the updated files under `tests/golden/`. Say why in the PR.
- **Changed the control API?** Run `pnpm contract`. It rewrites `contracts/control-api.openapi.json` and `apps/web/src/api/schema.gen.ts`; commit both. If the UI no longer type-checks, the UI needs updating too.
- **Emulating something new from a provider?** Add or extend a JSON Schema in `contracts/providers/`, written from the provider's public docs (link the page in the schema's `description`). Never copy real payloads that contain anyone's data.

## Adding an adapter

Each provider is one module in `apps/server/src/phonybox/adapters/` exporting an `AdapterSpec`, plus one line in the registry. The [Build an adapter](https://rohitlavu11.github.io/phonybox/adapters/build-an-adapter) guide walks through a complete one. A new adapter PR should include:

- The adapter module and its registry entry.
- A provider schema in `contracts/providers/` and contract tests in `apps/server/tests/contract/`, covering at least: a send is stored in the right inbox, the provider's error shapes, the inbound webhook and its signature.
- An inspector entry in `apps/web/src/adapters/` if the adapter has settings worth showing.
- A docs page in `apps/docs/adapters/` and a row in the README's provider table.

Not sure an adapter fits? Open an [adapter request](https://github.com/rohitlavu11/phonybox/issues/new?template=adapter_request.yml) first.

## Pull requests

- Keep each PR to one change. Small PRs get reviewed faster.
- Write commit messages in the imperative ("Add Postmark adapter"), with a body explaining why when it isn't obvious.
- Add a line to `CHANGELOG.md` under "Unreleased" for anything a user would notice.
- UI changes: include a screenshot, light and dark if colors changed.

## Docs

```sh
pnpm docs         # http://localhost:5173/phonybox/
```

Pages are Markdown in `apps/docs`. Every page has an "Edit this page" link.

## Conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security issues: see [SECURITY.md](SECURITY.md), not public issues.
