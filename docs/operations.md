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

### What the first real deploys found (2026-11-22)

Releases 0.9.0, 0.10.0 and 0.11.0 never stayed up on Railway. None of them
reached the health check: HQ stopped while it started, before it listened.

- **The cause was Railway's settings, not the image.**
  - In **test**, `HQ_DATABASE_PATH` was a relative path (`data/...`), and
    `RAILWAY_RUN_UID` was not set. HQ ran as `node` in `/app`, which is
    read-only to it, so the start stopped with
    `EACCES: permission denied, mkdir 'data'`.
  - **production** had no volume and none of the variables below, so it
    stopped with `Set HQ_DATABASE_PATH to the SQLite file.`
  - Railway restarted it until it gave up, then marked it Crashed.
- **CI did not catch it,** because CI starts the image with the right
  settings. CI proves the image works. It cannot prove Railway is set up.
- **Both fixes are needed.** A relative path fails as above. `/data/hq.db`
  without `RAILWAY_RUN_UID=0` fails with "unable to open database file".
- **Then a second fault: the port.** With the database fixed, test started
  and passed its health check, but every request to its domain got a 502.
  Railway sets `PORT=8080`, so HQ listened on 8080. The domain sent traffic
  to 3000, the port the `Dockerfile` exposes. The health check uses `PORT`,
  so it passed while the site was down. Setting `PORT=3000` fixed it.
- **How it deploys today:** the Deploy job's secrets are not set, so it is
  skipped. Railway's own GitHub integration deploys `main` to **both**
  environments. Until that changes, test runs what production runs.

### Railway settings that work

Set these for each environment, then check them in the service's Settings
and Variables tabs:

| Setting | Value |
| --- | --- |
| Volume | Attached to the service, mounted at `/data` |
| `HQ_DATABASE_PATH` | `/data/hq.db`. It must start with `/data/`: a relative path is inside the read-only app folder |
| `RAILWAY_RUN_UID` | `0` |
| `PORT` | `3000`, the same as the domain's target port. Without it Railway uses 8080 and the domain answers 502 |
| Replicas | 1 |
| Start command | Empty. The `Dockerfile` runs `bin/start.sh` |
| Health check | `/healthz`, 60 seconds (from `railway.json`) |
| Restart policy | On failure (from `railway.json`) |
| Domain | test: Railway's domain. production: `hq.potomac.solutions` |

### Checking a deploy is healthy

1. The deploy log shows the migrations (`Applied ...` or
   `Nothing to apply`), the lines about backups, alerts and email, and then
   `Potomac HQ is listening on port ...`. No `EACCES`, no
   `unable to open database file`, no `Set HQ_...`.
2. The deployment is **Active**, not Crashed, and it stays Active for ten
   minutes, past the first site check.
3. `curl https://<domain>/healthz` answers `{"ok":true}`.
4. Redeploy once. The second start says `Nothing to apply`, which shows the
   database is on the volume and survived.

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
| `HQ_GITHUB_TOKEN` | A fine-grained GitHub token with Contents read and write on the client sites' repositories only (see "Site content") | For clients changing their own site |
| `HQ_GOOGLE_CALENDAR_ID`, `HQ_GOOGLE_SERVICE_ACCOUNT` | A Google Calendar whose busy times booked calls avoid, and a service account's key (defaults to the sheet's) | Optional |

Set `PORT` to `3000` (see "Railway settings that work"). `HQ_CACHE_DIR` is
set by the container.

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

## Booked calls

Email about booked calls goes through the same Brevo setup as everything
else. With no email set up, people book as usual and are told to bookmark
their call's page. The day-before reminder runs every ten minutes from
`bin/serve.ts`, and sends each one once.

Link the website to `HQ_PUBLIC_URL/book` once "Anyone can book a call at
/book" is on under Calls → Hours.

**Avoiding your Google Calendar.** Without it, open times avoid only calls
already booked in HQ. To avoid everything in your calendar:

1. Use the finance sheet's service account, or make one in Google Cloud
   (IAM → Service accounts → Keys → Add key → JSON). Turn on the Google
   Calendar API for its project.
2. In Google Calendar, open your calendar's settings → Share with specific
   people → add the service account's address (it ends
   `.iam.gserviceaccount.com`) with "See only free/busy (hide details)".
3. Set `HQ_GOOGLE_CALENDAR_ID` to the calendar's id (for your main calendar,
   your Google email), and `HQ_GOOGLE_SERVICE_ACCOUNT` to the key file's JSON
   if it is not the sheet's.
4. Restart. The log says "Booked calls avoid busy times in Google Calendar
   …", and Calls → Hours says so too.

HQ only ever asks Google whether a time is busy: it never sees what an event
is. If Google can't be reached, the booking pages offer no times and say to
try again in a minute, rather than offer a time that might be taken.

## The inquiry form

`HQ_PUBLIC_URL/contact` takes inquiries from anyone, into the CRM as new
opportunities from the website. Each is emailed to `HQ_INQUIRY_EMAIL`, or
`HQ_CONTACT_EMAIL`, or `HQ_ALERT_EMAIL`.

To put the form on potomac.solutions itself, list the site in
`HQ_FORM_ORIGINS` (like `https://potomac.solutions`) and post a plain form:

```html
<form method="post" action="https://HQ_PUBLIC_URL/contact">
  <input name="name" required> <input name="email" type="email" required>
  <input name="phone" type="tel"> <input name="business">
  <textarea name="message" required></textarea>
  <input name="return_to" type="hidden" value="https://potomac.solutions/thanks">
  <!-- For bots: hide it with CSS, never fill it in. -->
  <input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-10000px">
  <button>Send</button>
</form>
```

To credit an inquiry to a referral link, the form must pass the link's code
on. A scan lands on the site with `?ref=<code>` in the address. Add a hidden
field and fill it from the address:

```html
<input name="ref" type="hidden">
<script>
  document.querySelector('input[name=ref]').value = new URLSearchParams(location.search).get('ref') || sessionStorage.getItem('ref') || ''
  if (new URLSearchParams(location.search).get('ref')) sessionStorage.setItem('ref', new URLSearchParams(location.search).get('ref'))
</script>
```

Keeping it in `sessionStorage` carries the code from the page they landed
on to the page with the form. HQ's own `/contact` needs none of this.

To say where on the site the person was (the lead sources report, decision
0010, section 2), add hidden fields: `src` (`stop:lakes`, `lab:counter`,
`work:better-days-towing`, `planner`, `blog:<slug>` or `newsletter`), `page`
(the path, like `/stops/lakes`), and any of `utm_source`, `utm_medium` and
`utm_campaign` the visitor arrived with. The website's booking call
(`POST /api/site/booking`) takes the same fields, and `ref`, in its JSON.
HQ keeps the first it sees for each opportunity; anything odd is dropped,
never refused. HQ's own `/contact?src=...` passes `src` on by itself.

`return_to` must be on a listed site; HQ sends people back there with
`?done=` or `?problem=` and a sentence to show. Only `/contact` accepts
posts from those sites. Five an hour from one address, three a day for one
email.

## Site content

Clients change their own site's photos, notice and reviews in the portal,
and HQ commits what you publish to the site's repository
(`docs/decisions/0003-site-content.md`). It needs one variable:

`HQ_GITHUB_TOKEN`: a GitHub fine-grained personal access token.

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate
   new token.
2. Resource owner: the organization that owns the client sites
   (Potomac-Solutions). Repository access: only the client sites'
   repositories. Never "All repositories", and never HQ's own.
3. Repository permissions: **Contents: Read and write**. Nothing else.
4. Set an expiry and put a renewal for it in HQ, so it does not run out
   unnoticed. When it does, publishing answers "GitHub refused".
5. Set it in Railway for the environment, and redeploy.

Commits are made as the token's owner. If a site's branch is protected,
that person must be allowed to push to it, or publishing is refused.

To make a site ready: it needs its content in one JSON file in the shape
the decision describes, and its page code reading that file. Then set it
up on the client's page in HQ.

Without the token HQ starts and says "Site content can't be set up or
published". Everything else works.

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
| The log says `EACCES: permission denied, mkdir 'data'` | `HQ_DATABASE_PATH` is a relative path. Set it to `/data/hq.db` |
| The deploy is Active but the domain answers 502 "Application failed to respond" | The log's "listening on port" is not the domain's target port. Set `PORT=3000` |
| The log says `Set HQ_DATABASE_PATH` and the deploy is Crashed | The environment's variables are not set. See "Railway settings that work" |
| "Something went wrong" on a page | The log line with `"level":"error"` at that time. It has the address and the stack |
| Nobody can sign in | Is `HQ_SECURE=true` and the address https? Is `HQ_PROXIES=1`? |
| You are locked out | In Railway's shell: `npm run reset-link -- you@example.com` prints a one-time link |
| No backup last night | The log at 3:17 AM Eastern, and the audit history filtered to `backup.` |
| A deploy did nothing | The Deploy job in GitHub Actions. "Skipped" means a secret or the service name is missing |

## Our own website (potomac.solutions)

Company → Our website controls potomac.solutions: whether it is open, the
"coming soon" or "maintenance" page, an announcement across the top, and a
private preview link. Admins only (`public-site.view`, `public-site.edit`).

To connect the website (once):

1. On HQ's server, run `npm run site:token`. It prints a token once and keeps
   only its hash. Run it again any time to replace the token; the old one stops
   working.
2. On the website's Railway service, set `HQ_URL` to HQ's address and
   `HQ_SITE_TOKEN` to that token. Before it is connected, or if HQ cannot be
   reached the first time, the website uses its `SITE_MODE` variable.
3. HQ's `HQ_FORM_ORIGINS` should list the website's address
   (`https://potomac.solutions`). The first one is used to build the preview
   link.

The website asks `GET /api/site/settings` with `Authorization: Bearer <token>`
about every 30 seconds and keeps the last answer if HQ is down, so an HQ outage
never opens or closes the site by itself. The address is limited to 120 requests
a minute per caller and answers 401, with no reason, to anything without the
right token.

The same token lets the website book calls. `GET /api/site/booking` answers the
open times; `POST /api/site/booking` (JSON: name, email, phone, business, topic,
start, and `visitor`, the visitor's address) books someone new or emails someone
already on file a sign-in link. It is open only when "Anyone can sign up at
/book" is on, hours are set and email works. Each visitor address may try 5
times an hour and each email 3 times a day.

## The newsletter

Sales → Newsletter (`newsletter.manage`) is "Notes from the river"
(`docs/decisions/0013-growth-tools.md`, section 1). It needs email (the
Brevo key) and `HQ_CONTACT_ADDRESS`: every issue ends with Potomac's mailing
address, which US anti-spam law asks for, and sending refuses to start
without it. Issues go out a batch of 50 a minute.

People sign up three ways:

- HQ's own page, `HQ_PUBLIC_URL/river`. Add `?src=stop:lakes` (or any stop:
  `mountains`, `lakes`, `roadside`, `history`, `enterprise`) to put them in
  that stop.
- A plain form on potomac.solutions posting to `HQ_PUBLIC_URL/river`, with
  `email`, `name` (optional), `src`, `return_to` and the empty `website` trap,
  like the inquiry form. The site must be in `HQ_FORM_ORIGINS`.
- The website's server, with its token: `POST /api/site/newsletter` (JSON:
  `email`, `name`, `src`, and `visitor`, the visitor's address). It answers
  `{ ok: true, status: "check-email", message }`, or `{ ok: false, error,
  message }` with a sentence to show.

Either way they get an email with a confirm link, and are on the list only
once they press Confirm. Five tries an hour from one address, three a day
for one email. The answer is the same whether or not they were already on
the list.

Every issue carries a one-click unsubscribe link and a `List-Unsubscribe`
header. Mail apps post to `/river/one-click?t=...`, which needs no cookie
or Origin.

