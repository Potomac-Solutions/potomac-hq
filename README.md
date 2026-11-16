# Potomac HQ

The internal operations platform for Potomac Solutions.

Status: v0.1 to v0.5 are built on `staging` and nothing is deployed yet. The
deploy and backups wait on the Railway project and the R2 bucket.

## Read first

- `docs/workflow.md`: how a job runs from first inquiry to paid.
- `docs/tool-boundaries.md`: what HQ does and what stays in outside tools.
- `docs/decisions/0001-stack.md`: the stack and why.
- `docs/data-model.md`: the first slice of records.
- `docs/authorization-matrix.md`: who may do what.
- `docs/scope-v0.1-v0.2.md`: what v0.1 and v0.2 include and leave out.
- `docs/scope-v0.3-v1.0.md`: the same for the later releases, with the
  decisions made while building them.
- `docs/decisions/0002-file-storage.md`: where uploaded files are kept.
- `docs/conventions.md`: branches, releases and project rules.

## Layout

```
src/<module>/index.ts          the only door into a module
src/<module>/adapters.ts       a second door, for infrastructure code and bin/ only
src/<module>/domain/           entities and rules, imports only shared/domain
src/<module>/application/      use cases, imports domain
src/<module>/infrastructure/   database, storage and email adapters
src/<module>/api/              HTTP routes, imports application
src/<module>/ui/               Zubra components and pages, imports api/contracts and shared/ui
src/shared/ui/                 the design system: theme, assets, Zubra UI copies
src/app.zb, src/error.zb       the shell around every page, and the 404 and 500 page
src/services.ts                builds every module's stores and services from one database
src/app.ts                     the composition root: wires every layer together
bin/                           commands: serve, migrate, reset-link
types/                         type declarations for the kit
migrations/                    versioned SQL migrations, the only way the schema changes
test/integration/              tests that cross modules or use real packages
test/support/                  setup the integration and browser tests share
test/e2e/                      browser tests
tools/                         boundary self-test and release scripts
```

Modules so far: `shared`, `identity`, `dashboard`, `crm`, `projects`, `files`, `notes`, `proposals`, `finance`. The import rules are in
`.dependency-cruiser.cjs`, with `tools/boundaries/zb-check.mjs` holding `.zb`
files to the same rule. CI fails when one is broken.

Pages are Zubra components served by `@zubra/router`. A page says its address
with `'use route'`, and its `load` gets the app's services through `context`
(`PageContext` in `src/app.ts`). A page file imports no application or
infrastructure code.

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

Backups: make the key pair on your own computer, give the server only the
public key, and keep the private key and its passphrase somewhere safe.

```sh
HQ_BACKUP_KEY_PASSPHRASE='…' npm run backup:keygen -- ./hq-backup
npm run backup                       # one backup now, with the server's settings
HQ_BACKUP_KEY_PASSPHRASE='…' npm run restore -- <backup file> ./hq-backup.private.pem ./restored.db
```

Forgot the password? HQ sends no email yet, so run this where the database
lives:

```sh
npm run reset-link -- you@example.com
```
