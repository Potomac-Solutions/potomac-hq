# Changelog

All notable changes to Potomac HQ are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Every pull request into `staging` adds a line under Unreleased. A release
moves those lines under a version heading. See `docs/conventions.md`.

## [Unreleased]

### Added

- M0 discovery documents: workflow, tool boundaries, stack decision 0001,
  first-slice data model and authorization matrix.
- Repository scaffold: `src/<module>/<layer>` structure for the `shared`,
  `identity` and `crm` modules, with one public entry file per module.
- Boundary lint (dependency-cruiser) that fails when `domain` or `application`
  imports Zubra, a UI framework or another module's internals, with a
  self-test that proves each rule fires.
- Test runners: `node:test` for domain, unit and integration tests, Playwright
  for end-to-end tests.
- CI on GitHub Actions, including a job that runs domain tests with no
  packages installed.
- Release automation: a changelog gate on pull requests and an automatic
  GitHub release when `staging` is merged into `main`.
- Scope for v0.1 and v0.2, cut to the smallest version that supports the
  first slice (`docs/scope-v0.1-v0.2.md`).
- Shared domain types: `Id`, `Money` (whole minor units plus a currency) and
  a `Result` type for answers given as codes.
- Migration runner: numbered, forward-only SQL migrations with checksums,
  each applied in its own transaction, and an `npm run migrate` command.
- Database helper that opens SQLite with foreign keys on and wraps work in a
  transaction.
- Activity events: the append-only `activity_event` table (migration 0001),
  with triggers that reject every update, delete and replace.
- Audit helper `recordActivity`, which every use case calls inside the same
  transaction as its change. It refuses context that names a secret.
- Users, roles and permissions (migration 0002), with the three roles seeded
  to match `docs/authorization-matrix.md`.
- `can()` and `authorize()`, the permission check every application service
  runs first. It denies by default and reads roles from storage each time.
- `createFirstAdmin`, which works only while HQ has no users.
- A test that fails if the authorization matrix document and the code differ.
- Sign-in through the Potomac kit's `staff` module: a one-time setup link for
  the first admin, sign-in, sign-out and change password, with accounts and
  sessions stored in SQLite (migration 0003).
- A rate limit on sign-in and link routes, a 16 KB limit on posted forms, and
  security headers on every response.
- An activity event for every sign-in, sign-out, password change and reset
  link.
- `npm start` and `npm run reset-link`, and `.env.example`.
- An end-to-end test of the sign-in workflow in a real browser.
- The application shell (`src/app.zb`), served by `@zubra/router`: a skip
  link, the top bar with the Potomac mark, navigation and account actions,
  and a 404 and 500 page inside the shell.
- The Potomac theme for Zubra UI: the website's neutrals with the mark's blue
  as the primary colour, every colour defined as a light and dark pair, and
  a test that checks each pair against WCAG AA contrast.
- Five Zubra UI components copied in at a pinned commit, with a check that
  fails if a copy is edited.
- The dashboard with its first panel, recent activity, read from the audit
  table. Admins see everything. Managers and members see activity on client
  records only.
- Sign-in, no-access and dashboard pages as Zubra components. Pages work with
  JavaScript turned off.
- A boundary check for `.zb` files, and automated accessibility checks (axe,
  WCAG 2.1 A and AA) on every screen in the browser tests.
- A workaround for a Zubra router bug found here and reported upstream
  (journey-to-code-org/zubra#300): the shell imports no component that a
  page also uses, because one imported by both was rendered twice.
- Deploy configuration for Railway: a Dockerfile, `railway.json` with a
  health check and one replica, and a deploy workflow that ships `staging` to
  the test environment and `main` to production after CI passes. It skips
  until the Railway tokens and service name are set.
- Nightly encrypted backups at 3:17 a.m. business time, to Cloudflare R2 or
  a local folder. The server seals each backup with a public key and cannot
  open it; only the private key can. Each backup, and each failure, is an
  activity event.
- `npm run backup`, `npm run backup:keygen` and `npm run restore`. Restore
  writes a new file, never over an existing one, and runs SQLite's integrity
  check.

### Changed

- Boundary lint: any module's domain may now import `src/shared/domain`.
  `shared/domain` still imports nothing.
- Boundary lint: a module may expose its infrastructure through
  `src/<module>/adapters.ts`, which only infrastructure code may import.
- Zubra packages upgraded from 5.15.0 to 5.17.0, and `@zubra/router` 5.17.0
  added. Nothing uses the router yet.
- The content security policy now allows scripts and stylesheets from HQ's
  own origin only. Nothing inline runs.
- Boundary lint: UI code may import the design system in `src/shared/ui`.
- The signed-out home page answers 401 with the sign-in form, where it
  answered 200.
- Outbound email will go through Brevo, wired in v0.2. Recorded in the stack
  decision, tool boundaries and scope.
- CI also runs on pushes to `main`, so the deploy can wait for it.
