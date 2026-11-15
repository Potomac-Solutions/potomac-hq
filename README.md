# Potomac HQ

The internal operations platform for Potomac Solutions.

Status: v0.1 (foundation) is in progress. Sign-in works. There is no shell,
dashboard, deploy or backup yet.

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
src/app.ts                     the composition root: wires every layer together
bin/                           commands: serve, migrate, reset-link
types/                         type declarations for the kit
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

To start HQ locally:

```sh
export HQ_DATABASE_PATH=data/hq.db
export HQ_NOTICE_SECRET="$(openssl rand -base64 32)"
npm run migrate
npm start
```

The first start prints a one-time link for setting up the first admin. See
`.env.example` for every setting.

Forgot the password? HQ sends no email yet, so run this where the database
lives:

```sh
npm run reset-link -- you@example.com
```
