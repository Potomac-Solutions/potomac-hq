# Potomac HQ

The internal operations platform for Potomac Solutions.

Status: M0 (discovery) complete. v0.1 (foundation) has not started. The repo
holds the scaffold only, with no features.

## Read first

- `docs/workflow.md`: how a job runs from first inquiry to paid.
- `docs/tool-boundaries.md`: what HQ does and what stays in outside tools.
- `docs/decisions/0001-stack.md`: the stack and why.
- `docs/data-model.md`: the first slice of records.
- `docs/authorization-matrix.md`: who may do what.
- `docs/scope-v0.1-v0.2.md`: what v0.1 and v0.2 include and leave out.
- `docs/conventions.md`: branches, releases and project rules.

## Layout

```
src/<module>/index.ts          the only door into a module
src/<module>/adapters.ts       a second door, for infrastructure code and bin/ only
src/<module>/domain/           entities and rules, imports only shared/domain
src/<module>/application/      use cases, imports domain
src/<module>/infrastructure/   database, storage and email adapters
src/<module>/api/              HTTP routes, imports application
src/<module>/ui/               Zubra components, imports api/contracts
bin/                           commands that wire modules together (migrate)
migrations/                    versioned SQL migrations, the only way the schema changes
test/integration/              tests that cross modules or use real packages
test/e2e/                      browser tests
tools/                         boundary self-test and release scripts
```

Modules so far: `shared`, `identity`, `crm`. The import rules are in
`.dependency-cruiser.cjs` and CI fails when one is broken.

## Run it

Needs Node 26.

```sh
npm ci
npm run check
npx playwright install chromium   # once
npm run test:e2e
```
