# Security review, v1.0

Date: 2026-11-16. Status: a self-review, done while Mikey was away, by the
same hand that wrote the code. **It is not an independent review.** The
roadmap's v1.0 gate should be read as still open until someone else has
looked, or Mikey decides this is enough for an internal tool.

Each line says what was checked and what checks it on every merge.

## Who can get in

| Checked | How it holds | Tested by |
| --- | --- | --- |
| Passwords are hashed with scrypt, never stored or logged in readable form | The kit's `staff` module | Kit's own tests |
| Sign-in is rate limited per address, and an account locks after repeated failures | `staffRoutes`, and the kit | `sign-in.test.ts` |
| Sessions are cookies that scripts cannot read, sent only to this site, and only over https in production | The kit, with `HQ_SECURE=true` | `sign-in.test.ts` |
| One-time links work once, expire, and are never written to the audit log | The kit. HQ shows a link once on a page that is not cached | `people.test.ts`, `portal-pages.test.ts` |
| An account with no HQ user gets nothing | `establishUser` | `sign-in.test.ts`, `people.test.ts` |
| Turning a user off ends their sessions at once | `setUserStatus` | `people.test.ts` |
| HQ always has an admin who can sign in | `mayStopBeingAdmin` | `user.test.ts`, `people.test.ts` |

## What they can do once in

| Checked | How it holds | Tested by |
| --- | --- | --- |
| Every change checks a permission before it does anything | Each application service calls `authorize` first | Each module's tests refuse a role without the permission |
| Roles are read from the database on every request, never from the session | `authorize` | `people.test.ts`: a role change applies to the next request |
| The document, the code and the database agree on who may do what | | `authorization-matrix.test.ts` |
| A page is never shown without its guard | Every page's `load` calls `context.guard()` first | `test/zubra/regression.test.ts`: every page answers 401 signed out |
| A client sees only their own organization's shared records | Portal services take the session's organization and nothing from the browser | `portal-isolation.test.ts` |
| A client's session opens no HQ page and posts to no HQ form | Separate accounts and a separate cookie | `portal-isolation.test.ts`, with page and form lists read from the source |

## What comes in from a browser

| Checked | How it holds | Tested by |
| --- | --- | --- |
| A form post from another site is refused | The `Origin` header must be this site | `crm-pages.test.ts` |
| Posts are size limited before they are read, and must be forms | `src/app.ts` | `crm-pages.test.ts`, `proposal-pages.test.ts` |
| Text from a record is escaped wherever it is shown | Zubra escapes every binding. No page prints raw HTML | `test/zubra/regression.test.ts` |
| Nothing inline runs | Content policy: scripts and styles from this origin only | `sign-in.test.ts`, `test/zubra/regression.test.ts` |
| No SQL is built from typed text | Every statement is prepared with parameters. Search escapes `%` and `_` | `knowledge.test.ts`, `audit.test.ts`, `search.test.ts` |
| Search shows only what the person may already see | Each kind of record is searched only with its own view permission | `search.test.ts` |
| Uploads are checked by content, size limited, and served as downloads | The file service | `project-pages.test.ts` |
| A file a client sends gets the same checks, is theirs alone, and is capped at 20 a day for a project | `saveFileFromClient` | `portal-client-pass.test.ts`, `portal-isolation.test.ts` |
| A message shown after a redirect is one the server signed | The kit's notices | `sign-in.test.ts` |
| A redirect never leaves this site | Locations are built by the server from fixed paths and checked ids | `test/zubra/regression.test.ts` |
| A CSV cell cannot run as a formula | `csvField` | `csv.test.ts` |

## What is kept

| Checked | How it holds | Tested by |
| --- | --- | --- |
| The audit log cannot be edited or deleted | Database triggers | `ops-commands.test.ts` |
| The audit log holds no secret | A context key that names one is refused | `activity.test.ts` |
| HQ never stores a card number | A payment reference that looks like one is refused | `finance.test.ts` |
| Backups can only be opened with a key that is not on the server | Sealed with the public key | `backup-commands.test.ts` |
| A notice email carries no amount, message, title or file name | `src/portal/domain/notices.ts` | `portal-notices.test.ts` |
| The export leaves out password hashes, sessions and links | `exportAll` | `ops-commands.test.ts` |
| The server runs as an unprivileged user with its code read-only, on Railway too, where the container has to start as root to reach the volume | `Dockerfile`, `bin/start.sh` | CI's container job, both ways |

## Known gaps

1. **No independent review**, as said above.
2. **No second factor.** A password alone opens HQ. Use a long one, and a
   password manager. Worth adding before a second person has admin.
3. **Rate limits are kept in memory.** They reset when HQ restarts, and
   would not be shared between two replicas. HQ runs one.
4. **Refused attempts are not written to the audit log**, only successful
   changes. A run of refusals shows in nothing but the request log.
5. **Dependencies are pinned but not watched.** Nothing tells Mikey when
   Hono, Zubra or the kit publishes a security fix. Turn on Dependabot
   alerts for the repository.
6. **A withdrawn invite's link still makes a sign-in account**, though one
   with no HQ user, so it opens nothing. That email cannot be invited again
   until the account is cleared by hand.
7. **A typed name as a signature** has not been checked by a lawyer.
8. **Files are not scanned for viruses.** A client can send a PDF, an
   Office file or a zip that is exactly what its name says and still
   harmful to open. Potomac's page says to open one only if it was
   expected. Open them on a computer that is kept up to date.
9. **The portal has never been used by a real client.** The isolation suite
   passes. Real use finds what tests do not.
