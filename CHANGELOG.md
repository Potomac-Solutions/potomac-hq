# Changelog

All notable changes to Potomac HQ are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Every pull request into `staging` adds a line under Unreleased. A release
moves those lines under a version heading. See `docs/conventions.md`.

## [Unreleased]

## [0.11.0] - 2026-11-22

- An admin without two-factor sign-in is reminded at the top of the
  dashboard, with a link to turn it on. It stays optional.
- Two-factor setup shows a QR code to scan with the authenticator app. It
  is served only to its owner while they turn it on, and never kept. The
  link the app reads is shorter: it leaves out settings every app assumes.
- Fixed: a withdrawn invite's link still made a sign-in account, which
  opened nothing in HQ but kept that email from being invited again.
  Withdrawing an invite now spends its link.
- Dependabot watches npm packages weekly, and GitHub Actions and the Node
  image monthly, and opens pull requests into staging. Security alerts are
  turned on in the repository's settings (docs/operations.md).
- Two-factor sign-in for HQ accounts, with an authenticator app. Turn it on
  in Settings: add HQ to the app by its link or key, enter a code, and get
  ten recovery codes, shown once. After that, HQ asks for a code after the
  password, and nothing in HQ opens until it is given. A code works once,
  the second step allows five tries a minute, and only hashes of recovery
  codes are kept. An admin can reset it on the People page for someone who
  lost their phone. Migration 0012.
- Search from the top bar, and a search page. One box finds clients,
  contacts (by name, email or phone), opportunities, projects, tasks (by
  title or description), proposals, invoices (by number, written any way:
  "INV-0003", "inv 3", "#3") and knowledge base articles. Every word typed
  must match. The best matches come first, up to eight of each kind. Each
  kind is searched only for someone who may see it.

## [0.10.0] - 2026-11-22

- Zubra packages upgraded from 5.19.0 to 6.0.3. All four move together and
  stay pinned to the exact version. Nothing in HQ needed to change: the type
  check, the Zubra regression suite, every integration test and every
  browser test with its accessibility checks pass as before.

- The dashboard opens with what clients are waiting on: a message nobody has
  answered, changes asked for on a deliverable, a call to return, a drafted
  invoice to send, and an invoice past its due day. Each line goes to the
  place to deal with it, and shows only to someone who may. It replaces the
  separate calls panel.
- Accepting a proposal drafts its deposit invoice, one third of a fixed
  price, for Potomac to check and send. Nothing reaches the client until it
  is sent. Hourly, monthly and yearly work gets none, and neither does a
  project that already has a deposit invoice.
- Time worked reads as hours and minutes ("2 h 31 min"), not as a decimal
  that looks like a clock time. Forms still take hours like "1.5".
- Days in HQ read "Fri, Nov 20, in 4 days" on the dashboard, projects,
  tasks, the board and reports.
- The top bar fits at a laptop's width: the board moved under Projects (it
  is linked from the Projects page and the dashboard), and the signed-in
  name gives way to the links where the bar is tight.
- Empty dashboard panels are one line instead of a box.
- Between a phone's width and about 1,120px the top bar's links take a
  second row instead of running off the edge. A browser test checks the bar
  at nine widths. The copied Zubra nav bar folds its links only below 640px;
  `docs/upstream/zubra-ui-nav-bar-fold.md` is the report to file.

## [0.9.0] - 2026-11-16

### Security

- Zubra packages upgraded from 5.17.0 to 5.19.0. 5.17.0 and 5.18.0 let some
  requests past a guard: a path starting `//`, a page whose pattern was
  spelled differently from its layout's, a `Host` header with a path in it,
  and a `redirect()` to another site.

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
  the test environment and `main` to production after CI passes. It is the
  last job in CI, and it skips until the Railway tokens and service name are
  set.
- Nightly encrypted backups at 3:17 a.m. business time, to Cloudflare R2 or
  a local folder. The server seals each backup with a public key and cannot
  open it; only the private key can. Each backup, and each failure, is an
  activity event.
- `npm run backup`, `npm run backup:keygen` and `npm run restore`. Restore
  writes a new file, never over an existing one, and runs SQLite's integrity
  check.
- v0.2's first slice, without pages yet: client organizations, contacts,
  opportunities and project stubs (migration 0004), their rules, and their
  services. Each service checks permission and writes an activity event in
  the same transaction. A won opportunity makes its client active and can be
  converted once into a project; monthly and yearly plans become ongoing
  projects. Deal prices are left out of everything a member is given.
- Amounts are read as people type them (`$1,250.00`) and shown the same way.
- Pages for the first slice: the clients list, a client's page with its
  contacts and opportunities, an opportunity's page with its stage, price,
  follow-up and conversion, and a project's page. Every form posts to the
  server and works with JavaScript turned off.
- The dashboard's second panel: follow-ups due, with overdue ones marked.
- Form posts are refused unless the browser says they came from HQ itself,
  are plain forms, and are under 16 KB.
- The pipeline (`/pipeline`): open opportunities grouped by stage, each
  with a button that moves it to the next stage and comes back.
- A status filter on the clients list, and an "Open opportunities" panel on
  the dashboard with a count for each stage.
- Outbound email through Brevo, and "Forgot your password?": a one-time
  link by email, answered the same whether or not the email has an account,
  sent only to active users, and rate limited per address and per email. It
  is off until the Brevo key and a sending address are set, and the sign-in
  page shows the link only when it is on.

- v0.3 Projects. A project now has an owner, a health, start and target
  dates and a description, with phases, milestones and tasks under it. The
  next milestone is always worked out from the plan. Built while Mikey was
  away: the open decisions it settled are in `docs/scope-v0.3-v1.0.md`.
- The projects list (`/projects`), a project's task list and board, a board
  across every active project (`/board`) with "only mine", and a page for
  each task. Cards are dragged between columns. Each card also has a small
  form that does the same, so the board works from the keyboard and with
  JavaScript turned off.
- Drag and drop on the pipeline, beside the existing buttons.
- A file service: uploads are limited to 25 MB and a fixed list of types,
  each checked against the file's first bytes. Every download is authorized
  on the server and sent as an attachment, and uploads and downloads are
  activity events. Files are kept in the database, so the nightly backup
  holds them (decision 0002).
- Deliverables on a project: a title, a file, and a switch that shares it
  with the client.
- Notes on clients, opportunities and projects. A note is written once.
- A project's history, read from the audit table.
- Dashboard panels for active projects and for milestones and tasks due in
  the next two weeks.
- Dark mode (issue #2). Each person chooses light, dark or their device's
  setting on a new Settings page. It needs no script.
- Eight permissions for the above, held by every role.

- v0.4 Proposals. A proposal is started from an opportunity, filled from a
  template for its service, and edited as a working copy: four sections and
  a table of estimate lines with a total, the hours and, for a fixed quote,
  the deposit of one third.
- Sending makes a numbered version that can never change (database triggers
  refuse it), prices the opportunity and moves it to quoted. Editing after
  that makes the next version, and the old ones stay readable.
- Each version has a page laid out for reading and printing, and a PDF that
  HQ writes itself, with no package added.
- Recording the client's answer notes who, when, how and to which version.
  Accepting wins the opportunity, starts its project and sets the project's
  baseline from the accepted estimate, as one change.
- A signed agreement is recorded against an accepted proposal: where the
  paper is kept, or a scan of it.
- Four proposal permissions, held by admins and managers. A member is sent
  no proposal and no baseline.

- v0.5 Time and budgets. The timer starts by itself when a task is moved to
  "working on" and stops when it is moved on, logging the time. Time can
  also be typed in on a new Time page, which shows a week at a time.
- Expenses on a project, each with a category, an amount, a day and an
  optional receipt kept by the file service.
- A Money tab on each project: hours and cost against the budget, hours by
  phase, margin as an operational estimate, payment status and the
  invoice's reference. The budget is the accepted proposal's until one is
  set by hand. A monthly or yearly plan is measured over its current
  period.
- A Money page across every project, with CSV exports of time, expenses and
  budget against actual, invoices and payments. Each export is recorded.
  Text a spreadsheet would run as a formula is defused.
- Invoices, as the tool boundaries ask: numbered in order with no gaps,
  drafted with lines, sent, voided, and downloaded as a PDF. Payments are
  recorded against a sent invoice by cash, check or a gateway's reference,
  and a reference that looks like a card number is refused. A project's
  payment status follows its invoices by itself.
- Finance records can be copied to a Google Sheet each night
  (`HQ_SHEETS_SPREADSHEET_ID`, `HQ_SHEETS_SERVICE_ACCOUNT`), into tabs of
  HQ's own that never touch anything else in the sheet. Off until both are
  set. Not yet run against a real sheet.
- Dashboard panels for hours this week and projects over budget.
- Nine permissions. Everyone logs their own time. Costs, budgets, expenses,
  invoices, payments and exports are for admins and managers.

- v0.6 Client portal, at `/portal`. A client user is separate from an HQ
  user, belongs to one client organization, and holds no HQ permission.
  They are invited from the client's page and get in by a link that works
  once: emailed when email is set up, shown once to the inviter when it is
  not.
- In the portal a client sees their projects with milestones, downloads
  shared deliverables and approves them or asks for changes, reads a shared
  proposal and accepts or declines it by typing their name, downloads sent
  invoices, reads updates and writes back, and asks for a call.
- On HQ's side: a portal panel on each client, updates on each project, and
  call requests on the dashboard. Four permissions. Inviting a client and
  switching their access is for admins and managers.
- An isolation suite that runs on every merge. It signs in as one client
  and tries every portal page, download and form against another client's
  records, and every HQ page and form with a client's session.

- v1.0 Platform. A People page where an admin invites someone with roles,
  withdraws an invite, changes roles, turns an account off or on and makes
  a new password link. HQ always keeps one admin who can sign in.
- A knowledge base with categories, tags, search and every revision kept,
  and a decision log inside it. It is filled from HQ's own documents when
  HQ starts.
- An audit history page for admins: every activity event, filtered by
  person, kind of record, action and day, with a CSV of the same filter.
- A Reports page for admins and managers: the pipeline and win rate,
  project health and what is late, and budget against actual.
- `npm run restore:drill` opens a backup, checks it, starts HQ on the copy
  and deletes it. `npm run export` writes every record and stored file to a
  folder. `npm run retention` applies the retention policy, which also runs
  each night.
- Errors are logged as JSON lines and, with `HQ_ALERT_EMAIL` set, emailed,
  at most once in fifteen minutes for the same error. The health check now
  tests the database and answers 503 when it cannot be read.
- `npm run test:zubra`, a regression suite for what HQ relies on Zubra to
  do. It runs in CI.
- Documents: an operations runbook with the first-deploy checklist, a user
  guide, a retention policy, and security and accessibility self-reviews
  that say what they did not cover.
- Three permissions: everyone reads the knowledge base, and admins and
  managers write in it and see reports.
- The client portal, reworked after a pass as four clients (a farmer, a
  movie theater owner, a body shop owner and a restaurant owner). It now
  fits a phone, with one column and buttons big enough to hit. The home
  page starts with what is waiting on the client. Days read "Sat, Nov 21,
  in 5 days". A project's steps are a checklist. A proposal says what it
  costs first and what happens after an answer. Invoices say what is owed
  in all and how to pay.
- Clients can send files on their own active projects: photos, a menu, a
  price list. Each is checked like every upload and is theirs alone. A
  project takes at most 20 a day. Potomac sees them on the project.
- A message can be sent from the portal's home page, the newest updates
  show there, and a call request takes a number to call back on.
- `HQ_CONTACT_PHONE`, `HQ_CONTACT_EMAIL` and `HQ_CONTACT_ADDRESS`: how
  clients reach Potomac, shown at the foot of every portal page.
- A milestone can be marked as the client's to do. Their portal lists it
  first, as "Your turn", with a button to send a file.
- A deliverable that is a picture is shown on the portal page.
- The dashboard has "From your clients": what clients did in the portal in
  the last two weeks. With email set up, the project's owner is emailed.
- With `HQ_CLIENT_NOTICES=on`, a client is emailed that something is
  waiting. The email says what kind of thing and never what it holds, and
  each client user can turn theirs off. Off by default.
- The container's start script handles Railway's root-owned volume: started
  as root it hands the database's folder to the unprivileged user and drops
  to it. `docs/operations.md` says to set `RAILWAY_RUN_UID=0`.

### Changed

- HQ's own sign-in uses the cheaper password hash in tests only. Nothing
  changes in production.
- The top bar shows only what the signed-in person may open: Proposals and
  Money are not offered to a member.

- The top bar's "Change password" link is now "Settings", which links on to
  the change password page.
- Shared test setup lives in `test/support/`, and the services are wired in
  one place (`src/services.ts`) for the app and the tests alike.

- Boundary lint: any module's domain may now import `src/shared/domain`.
  `shared/domain` still imports nothing.
- Boundary lint: a module may expose its infrastructure through
  `src/<module>/adapters.ts`, which only infrastructure code may import.
- Zubra packages upgraded from 5.15.0 to 5.17.0, and `@zubra/router` 5.17.0
  added. Nothing uses the router yet.
- Pages now send `Cache-Control: private, no-store`, from `@zubra/router`
  5.19.0. It was `no-store`.
- The content security policy now allows scripts and stylesheets from HQ's
  own origin only. Nothing inline runs.
- Boundary lint: UI code may import the design system in `src/shared/ui`.
- The signed-out home page answers 401 with the sign-in form, where it
  answered 200.
- Outbound email will go through Brevo, wired in v0.2. Recorded in the stack
  decision, tool boundaries and scope.
- CI also runs on pushes to `main`, so the deploy can wait for it.
