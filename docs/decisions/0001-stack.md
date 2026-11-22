# 0001. Stack, database, host and UI delivery

Status: approved 2026-11-14. Decided by: Mikey Nichols.

## Context

HQ is built and run by one developer. It must reuse the Potomac kit and Zubra
UI, keep Zubra at the UI boundary, and change its schema only through
versioned migrations.

Three facts about the kit (version 0.8.0, commit `41d3587`) shaped the choice:

1. It is plain JavaScript modules for Node 22.13 or later, with no
   dependencies.
2. Every stateful module is handed a store whose reads are synchronous and
   whose writes are stored before they return. The kit's README says a store
   that awaits before storing breaks its guarantees.
3. `auth` and `staff` use `node:crypto`, so they do not run on Cloudflare
   Workers.

## Decision

| Part | Choice |
| --- | --- |
| Language | TypeScript 6, type-checked by `tsc`, run directly by Node |
| Runtime | Node 26 (active LTS), pinned in the repo |
| Dates and times | The built-in `Temporal` API. Domain code never uses `Date` |
| HTTP | Hono |
| Database | SQLite, through Node's built-in `node:sqlite` driver |
| Migrations | Numbered SQL files, applied in order by a small runner that the deploy pipeline calls |
| Host | Railway: one service with a persistent volume holding the database file |
| Environments | Local, test and production. Test and production are Railway environments |
| File storage and backup copies | Cloudflare R2 |
| Outbound email | Brevo, behind the kit's `notify` interface. Wired in v0.2 |
| Node adapter | `@hono/node-server` 2.1.8, for the request listener only |
| UI rendering | Server-rendered Zubra components through `@zubra/server`, served as pages by `@zubra/router`. No client framework in the internal app |
| Second host framework | Held for the client portal at v0.6 |
| Zubra packages | Exact versions: `@zubra/server`, `@zubra/runtime`, `@zubra/compiler` and `@zubra/router` at 6.0.3, all four at one version, with no range. Nothing older than 5.19.0: 5.17.0 and 5.18.0 have router guard bypasses |
| Kit | Installed from GitHub at an exact commit |
| Zubra UI | Source `.zb` files copied in from commit `ba5737e` into `src/shared/ui/zubra`. `zubra-ui.lock.json` records the commit and a checksum per file, and CI fails if a copy is edited |
| Boundary lint | dependency-cruiser |
| Package manager | npm |
| Tests | `node:test` for domain and integration tests, Playwright for end-to-end tests |
| CI | GitHub Actions |

### Rules that come with it

- **No local edits to copied Zubra UI files or to the kit.** A fix goes
  upstream with the `found-by: potomac` label and is then re-copied or
  re-pinned.
- **Upgrades happen on a branch**, run the full suite, and merge only when
  green.
- **Identity uses `kit/staff`** for accounts, passwords, sessions and invites.
  The kit keeps these through a store adapter backed by the same SQLite file.
  HQ's own records (clients, opportunities, projects, activity events) are
  ordinary tables.
- **The sign-in route gets a rate limit** in HQ. The kit's lockouts are kept
  in the process and reset on restart, and its README asks for one.
- **Backups do not rely on Railway alone.** A daily job takes a consistent
  copy with SQLite's own backup command, encrypts it with a key only Mikey
  holds, and sends it to R2. Railway's volume backups are a second line.

## Options considered

| | A: Node + SQLite on one server (chosen) | B: Cloudflare Workers + Durable Object SQLite | C: Node + managed Postgres |
| --- | --- | --- | --- |
| Kit reuse | Works today | Blocked until `auth` and `staff` are ported to Web Crypto | Stateful kit modules do not fit an async store |
| Migrations and tests | Plain SQL files, tests against a real local file | Every integration test needs Cloudflare's local emulator | Simple |
| Backups with a key only Mikey holds | Simple | Possible, by exporting out of Cloudflare | Provider backups plus an encrypted dump |
| Main cost | One server to run | The first weeks go to porting the kit | Loses the kit |

For the UI shell, a React single-page app and a meta-framework were
considered. Server rendering won because the kit's components and its
`staff/pages` sign-in screens already work that way, and it is one build and
one process.

For Zubra UI delivery, waiting for published packages was rejected because
Zubra UI has no tagged release and the kit is not on npm.

## Consequences

- HQ runs as one instance. SQLite on a single volume does not allow several
  copies of the service, and a deploy may mean a few seconds of downtime. This
  is acceptable for an internal tool with one user.
- Moving to Postgres later means rewriting the infrastructure layer only,
  because domain and application code never touch the database driver.
- The Workers port of `auth` and `staff` stays emulation work. Hono runs on
  Workers, which keeps that path open.
- The kit has no type declarations. HQ writes thin typed wrappers for the kit
  modules it uses, in the infrastructure layer.
- Railway's Hobby plan is $5 a month with $5 of usage included, and Railway
  states that volumes and backups are encrypted at rest with AES-256. Both
  were checked on 2026-11-14 and should be rechecked before production.

- The kit (commit `41d3587`), `@zubra/server` and Hono load and pass the
  integration tests on Node 26. Confirmed 2026-11-14, on 5.15.0 and again on
  5.17.0, 2026-11-15 on 5.19.0, and 2026-11-22 on 6.0.3.
- `@zubra/router` was adopted at 5.17.0, its first release. It serves pages
  from components with no host framework, which is the shape HQ chose. Its
  `load` receives the app's services through `context`, so UI files still
  import no application or infrastructure code. Hono keeps the routes that
  are not pages.
- TypeScript stays on version 6 until dependency-cruiser supports version 7,
  whose compiler API it cannot read yet.

- Zubra UI's registry cannot be reached from the workspace HQ is built in,
  so the shadcn CLI cannot run there. The same source files are copied from
  a clone at the pinned commit instead. The checksum check replaces trust in
  the CLI.
- Zubra is run with `inline: false`, so pages carry no inline script or
  style block and the content security policy allows neither. Inline style
  attributes are allowed, because server-rendered Zubra UI components use
  them (`nav-bar` at this commit).
- UI files may import the design system in `src/shared/ui` as well as their
  own module's `api/contracts`. Everything else a page needs reaches it
  through `load`'s `context`.

## Open items

1. **Confirm on Railway**: that a service with a volume runs as a single
   instance, and how long a deploy interrupts it.

## Sources

- [Railway volume backups](https://docs.railway.com/volumes/backups)
- [Railway volumes reference](https://docs.railway.com/volumes/reference)
- [Railway Help Station: encryption at rest](https://station.railway.com/questions/data-protection-questions-encryption-a-e5128546)
- [Railway pricing, third-party summary](https://toolradar.com/tools/railway/pricing)
- [Node.js 26.0.0 release notes](https://nodejs.org/blog/release/v26.0.0)
- Potomac kit README at commit `41d3587`
