## What and why

<!-- What this changes, and the problem it solves. Link the issue if there is one. -->

## Checks

- [ ] `uv run pytest` passes (and against PostgreSQL, if this touches the store)
- [ ] Golden files or the OpenAPI snapshot changed only on purpose (`--update-golden` / `pnpm contract`)
- [ ] Docs updated, if behavior changed
- [ ] `CHANGELOG.md` updated under "Unreleased", if a user would notice
- [ ] Screenshots attached, if the inspector changed
