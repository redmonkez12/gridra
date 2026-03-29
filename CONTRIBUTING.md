# Contributing

## Development Workflow

1. Install dependencies with `npm install --cache .npm-cache`.
2. Run `npm run lint`, `npm run typecheck`, and `npm test` before opening a change.
3. Use `npm run dev` to work against the demo app in `examples/demo`.

## API Discipline

- Treat `@gridra/core` and `@gridra/react` package root exports as the only supported public surface.
- Do not introduce new deep-import requirements.
- Keep `@gridra/table-reference` private and demo-focused.

## Versioning

- Follow SemVer seriously, even before `1.0.0`.
- `0.1.0` is the first public release.
- Use minor version bumps for additive package changes during the `0.x` phase.
- Treat public API cleanup or other breaking changes as explicit release events during `0.x`; document them in a changeset so release notes are generated from source.
- Reserve `1.0.0` for the point where the public API is intentionally stable.

## Pull Requests

- Describe user-visible behavior changes and API changes clearly.
- Add or update tests for behavior changes.
- Add a changeset for any pull request that changes the public behavior, API, or packaging of `@gridra/core` or `@gridra/react`.
- Use `npm run changeset` to create it, or `npx changeset add --empty` when a PR must explicitly skip a release.
- Do not edit `CHANGELOG.md` by hand; Changesets generates release notes during versioning.
