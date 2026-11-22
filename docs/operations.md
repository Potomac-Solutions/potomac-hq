# Operations

Status: written 2026-11-16 while Mikey was away. Nothing here has been done
against the real Railway project yet. Correct this document the first time
each step is done for real.

How Potomac HQ is deployed, watched, backed up and restored.

## How a deploy happens

1. A pull request is merged into `staging`. CI runs every check.
2. When CI passes, the Deploy job sends that commit to Railway's **test**
   environment.
3. A release pull request from `staging` into `main` is merged by Mikey. CI
   runs again, then deploys the same commit to **production**, and a GitHub
   release is published.
4. Railway builds the `Dockerfile`. When the container starts it applies any
   new migrations, then serves. Railway waits for `/healthz` to answer before
   sending traffic to it, and keeps the old one running if it never does.

Until the Railway secrets below exist, the Deploy job says "Skipped" and
passes.

## First deploy checklist

Do it for the test environment first, then again for production.

### In Railway

1. Make a project with two environments, `test` and `production`.
2. Add a service from the GitHub repository `Potomac-Solutions/potomac-hq`.
   Turn **off** Railway's own deploy-on-push for it: CI deploys, so that
   nothing ships before its checks pass.
3. Add a **volume** to the service, mounted at `/data`. The database is one
   file on it. Without the volume, every deploy starts empty.
   Railway mounts a volume owned by root, so also set `RAILWAY_RUN_UID=0`
   (Railway's own instruction for images that do not run as root). HQ still
   does not run as root: its start script hands `/data` to the unprivileged
   `node` user and drops to it before anything else runs. CI checks this.
4. Keep it at one replica. SQLite is one file and one writer.
5. Set the variables in the table below.
6. Give the service a domain. Production: `hq.potomac.solutions`.

### Variables

| Variable | Value | Needed |
| --- | --- | --- |
| `HQ_DATABASE_PATH` | `/data/hq.db` | Yes |
| `RAILWAY_RUN_UID` | `0` | Yes, with a volume. Without it HQ cannot write its database and will not start |
| `HQ_NOTICE_SECRET` | 32 or more random characters: `openssl rand -base64 32`. Different in each environment | Yes |
| `HQ_SECURE` | `true` | Yes |
| `HQ_PROXIES` | `1` | Yes |
| `HQ_PUBLIC_URL` | The https address people use, with no slash at the end | Yes |
| `HQ_BREVO_API_KEY`, `HQ_EMAIL_FROM` | Brevo key, and a sender address verified in Brevo | For email: reset links, invites, alerts |
| `HQ_ALERT_EMAIL` | Where errors are emailed | Recommended. Needs the two above |
| `HQ_CLIENT_NOTICES` | `on` to email a client when something is waiting in the portal. Read the wording in `src/portal/domain/notices.ts` first | Optional. Off by default. Needs Brevo |
| `HQ_CONTACT_PHONE`, `HQ_CONTACT_EMAIL`, `HQ_CONTACT_ADDRESS` | Potomac's phone, email, and the address a check is mailed to, on one line. Shown to clients in the portal | Recommended before a client is invited |
| `HQ_BACKUP_PUBLIC_KEY` | The public key from `npm run backup:keygen` | For backups |
| `HQ_BACKUP_R2_ACCOUNT_ID`, `HQ_BACKUP_R2_BUCKET`, `HQ_BACKUP_R2_ACCESS_KEY_ID`, `HQ_BACKUP_R2_SECRET_ACCESS_KEY`, `HQ_BACKUP_R2_PREFIX` | The R2 bucket. Use prefix `test` and `production` | For backups |
| `HQ_SHEETS_SPREADSHEET_ID`, `HQ_SHEETS_SERVICE_ACCOUNT` | The Google Sheet and a service account's key | Optional |

`PORT` is set by Railway. `HQ_CACHE_DIR` is set by the container.

A setting that is half filled in stops HQ from starting and says which one,
so a missing backup or a dead alert is never silent.

### In GitHub

In the repository's settings, under Secrets and variables, Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `RAILWAY_TOKEN_TEST` | A project token for the test environment |
| Secret | `RAILWAY_TOKEN_PRODUCTION` | A project token for the production environment |
| Variable | `RAILWAY_SERVICE` | The service's name in Railway |

Each token can deploy to its own environment only.

### After the first start

1. Open the service's log. It prints a one-time link: "Set up the first
   admin here". Open it, and make your account. It works once, for a day.
2. Check the log's other lines. It says whether backups, error alerts and
   the finance sheet are on.
3. Run a backup now: in Railway's shell for the service, `npm run backup`.
   Check the file is in the bucket.
4. Run a restore drill on that file (below), and write it in the log at the
   end of this document.

## Watching it

- **Health:** `/healthz` answers `{"ok":true}` when HQ can read its
  database, and 503 when it cannot. Point an outside uptime check at it.
  HQ does not watch itself from outside: if the whole service is down, only
  an outside check will say so.
- **Errors:** every error is one line of JSON in Railway's log, with
  `"level":"error"`. Search the log for that.
- **Alerts:** with `HQ_ALERT_EMAIL` set, each error is also emailed. The
  same error is emailed at most once in fifteen minutes. A failed nightly
  backup, sheet update or retention run is an error like any other.
- **Notices:** once a minute HQ emails Potomac's own people about what
  clients did. A notice that could not be sent is logged as an error and is
  not tried again. The audit history, filtered to `notice.`, shows each run
  that sent something.
- **Each night:** 3:17 AM backup, 3:47 AM finance sheet, 4:07 AM retention,
  Eastern time. Each writes a line to the log, and the backup writes an
  activity event either way.

## Backups

Backups are sealed with a public key. Only the private key opens them, and
the private key is never on the server.

```sh
HQ_BACKUP_KEY_PASSPHRASE='…' npm run backup:keygen -- ./hq-backup   # once, on your own computer
```

Give the server `hq-backup.public.pem` as `HQ_BACKUP_PUBLIC_KEY`. Keep
`hq-backup.private.pem` and its passphrase in two different safe places.
**If both are lost, every backup is unreadable.**

## Restore drill

A backup that has never been opened is a hope, not a backup. Run a drill
after the first deploy, then every three months, and after any change to
how backups are made.

```sh
# On your own computer, in a checkout of the same version that made the backup.
# Download one backup file from the bucket first.
HQ_BACKUP_KEY_PASSPHRASE='…' npm run restore:drill -- <backup file> ./hq-backup.private.pem
```

It opens the backup into a temporary folder, checks the copy is whole and
matches the code, starts HQ on it, asks for a page, and deletes the copy.
It changes nothing anywhere else. It ends with `RESULT: PASS` or
`RESULT: FAIL`.

### Restore drills

Write each one here.

| Date | Backup | Result | Newest record in it | Who |
| --- | --- | --- | --- | --- |
| 2026-11-16 | A backup of a test database, made and opened on the development machine | PASS | Not real records | Automated test (`test/integration/ops-commands.test.ts`) |

**No drill has been run on a real backup from the R2 bucket yet.** The
roadmap's v1.0 gate asks for one.

## Restoring for real

1. Stop the service in Railway, so nothing writes while you work.
2. On your own computer: `npm run restore -- <backup file>
   ./hq-backup.private.pem ./restored.db`. It refuses to overwrite a file,
   and checks the result.
3. Put `restored.db` on the volume as `/data/hq.db`, keeping the old file
   under another name until you are sure.
4. Start the service. It applies any newer migrations, then serves.
5. Everything recorded after the backup was taken is gone. Tell anyone it
   affects.

## Taking the data out

```sh
HQ_DATABASE_PATH=/data/hq.db npm run export -- /tmp/hq-export
```

One JSON file per table and every stored file, with a `manifest.json`.
Password hashes, sessions and one-time links are left out. The folder holds
client records: keep it safe and delete it when done. The export is
recorded in the audit history.

## Upgrading Zubra

Zubra packages are pinned to one exact version.

1. Read the release notes for every version in between.
2. Change the four `@zubra/*` versions in `package.json` together, and run
   `npm install`.
3. Run `npm run test:zubra`, then `npm run check` and `npm run test:e2e`.
4. If something broke, file it at `journey-to-code-org/zubra` with the label
   `found-by: potomac`, and stay on the working version.
5. Never edit a file under `src/shared/ui/zubra`. Fix it upstream and copy
   it again.

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens pull requests into `staging`:
npm packages every Monday, GitHub Actions and the Node image once a month.
The four `@zubra/*` packages come as one pull request, so they move
together.

- Treat a Zubra bump like "Upgrading Zubra" above: read the release notes,
  and run `npm run test:zubra` and `npm run test:e2e` on the branch.
- Merge when CI is green. The changelog gate lets Dependabot's pull
  requests through, so when preparing a release, add a line for each bump
  merged since the last one (`git log --author=dependabot`).
- **Security alerts are a setting, not a file.** Once, in the repository:
  Settings → Code security → turn on Dependabot alerts and Dependabot
  security updates.

## When something is wrong

| What you see | Look at |
| --- | --- |
| The site does not answer | Railway: is the service running, and what does the end of its log say? A failed migration stops the start and names the migration |
| The log says "unable to open database file" or "permission denied" | `RAILWAY_RUN_UID=0` is not set, or the volume is not mounted at `/data` |
| "Something went wrong" on a page | The log line with `"level":"error"` at that time. It has the address and the stack |
| Nobody can sign in | Is `HQ_SECURE=true` and the address https? Is `HQ_PROXIES=1`? |
| You are locked out | In Railway's shell: `npm run reset-link -- you@example.com` prints a one-time link |
| No backup last night | The log at 3:17 AM Eastern, and the audit history filtered to `backup.` |
| A deploy did nothing | The Deploy job in GitHub Actions. "Skipped" means a secret or the service name is missing |
