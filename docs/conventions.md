# Conventions

Status: approved 2026-11-14. Source: M0 discovery interview.

## Branches

| Branch | Holds | Who merges |
| --- | --- | --- |
| `main` | Released versions only. Protected | Mikey, by merging `staging` |
| `staging` | Finished changes waiting for a release | Merged freely once CI is green |
| Feature branches | One change each, named `feat/...`, `fix/...`, `chore/...` or `docs/...` | Deleted after merge |

## A change

1. Branch from `staging`.
2. Make small commits.
3. Add a line under `[Unreleased]` in `CHANGELOG.md`.
4. Open a pull request into `staging`.
5. Merge when CI is green.

## A release

1. On a branch from `staging`, run `npm run release:prepare -- <version>`. It
   moves the Unreleased lines under the new version and sets the version in
   `package.json`.
2. Open a pull request into `staging` and merge it.
3. Open a pull request from `staging` into `main`. Mikey approves and merges.
4. The merge publishes a GitHub release tagged `v<version>`, with that
   version's changelog section as its notes.

Only `staging` may be merged into `main`. CI refuses anything else.

## Commits, pull requests and issues

- Authored as Mikey Nichols.
- No co-author lines and no tool attribution, in commits, pull requests or
  issues.
- Commit subjects use a type prefix: `feat:`, `fix:`, `docs:`, `chore:`,
  `test:`, `refactor:`.

## Project rules

- Domain rules and their tests run with no Zubra and no UI framework
  installed. CI proves it by running them with no packages at all.
- Every application service checks permission and writes an activity event in
  the change that adds it.
- Schema changes go through versioned migrations only.
- A decision not covered by the roadmap or `docs/` is asked, not guessed.

## Checks

| Command | What it checks |
| --- | --- |
| `npm run typecheck` | Types |
| `npm run lint:boundaries` | Layer and module import rules |
| `npm run lint:boundaries:selftest` | That each import rule still catches a violation |
| `npm run lint:components` | The same import rule for `.zb` component files, and its self-test |
| `npm run lint:zubra-ui` | That copied Zubra UI components are unedited |
| `npm run test:domain` | Domain tests only |
| `npm run test:unit` | Domain and application tests |
| `npm run test:integration` | Tests against a real database and real packages |
| `npm run test:e2e` | Browser tests, including accessibility checks on every screen |
| `npm run check` | Everything except browser tests |
| `npm start` | Starts HQ. Needs the settings in `.env.example` |
| `npm run reset-link -- <email>` | Prints a one-time password reset link |
| `npm run migrate` | Applies pending migrations to the database at `HQ_DATABASE_PATH` |
