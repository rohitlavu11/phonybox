# Contributing

The full guide is in [CONTRIBUTING.md](https://github.com/rohitlavu11/phonybox/blob/main/CONTRIBUTING.md). The short version:

```sh
git clone https://github.com/rohitlavu11/phonybox && cd phonybox
pnpm install                 # web app + docs
(cd apps/server && uv sync --all-groups)
pnpm dev                     # server on :4100-4102, web app on :5173
pnpm test                    # server suite + UI type contract
pnpm --filter @phonybox/docs docs:dev   # this site
```

Good first contributions:

- **A new adapter**: see [Build an adapter](/adapters/build-an-adapter).
- **A missing endpoint or webhook** on Mailgun or Telnyx, with a schema written from the provider's docs.
- **Docs**: every page has an "Edit this page" link.

Please read the [Code of Conduct](https://github.com/rohitlavu11/phonybox/blob/main/CODE_OF_CONDUCT.md).
