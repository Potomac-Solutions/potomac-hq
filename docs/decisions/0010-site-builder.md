# 0010. The site builder: client websites made with Claude in HQ

Status: decided 2026-11-23 and 2026-11-25 at Mikey's request. On Nov 23:
build client websites from HQ with Potomac's own Claude API key; only Mikey
chooses the model; any owner-level person (him or Jayanti) can iterate on a
site's design with his tokens; sites are kept in HQ with a live preview; a
monthly budget with a hard stop. On Nov 25, marked **Confirmed** below:
sites go live in a new repository HQ creates, or in a client's existing
repository HQ edits ("1 or just lets us input the clients existing repo
and edits it. But if I can create a new repo with it great"); sites are
plain HTML, CSS and JavaScript; the cap starts at **$10 a month**; a site
starts from any of the client's HQ record, a written brief, uploaded photos
and logo, and an existing site to rework. The open choices are marked
**Default**: Claude's pick, to be confirmed or changed in review. Built by
Claude in the order under "Slices", one pull request into `staging` each.

Later on Nov 25 Mikey approved every choice marked **Default** ("I approve
them all so far"). They stand as decided.

## Context

Potomac gives every business a free landing page and builds paid sites
after that. Today each one is built by hand in a coding session, outside
HQ, and nothing in HQ knows a site exists until decision 0003 sets it up
for editing. Most of what a first draft needs is already in HQ: the
business name, contacts, phone, service area and notes.

## Decision

### 1. A build

A **build** is a website being made in HQ, under **Sites → Builder**. It
belongs to one client and holds:

- the **brief**: what the business does, who it's for, the tone, the pages
  wanted, anything to avoid. Written by whoever starts it;
- the **client's facts**, read from HQ when the build starts and each time
  Claude is asked for something, so a changed phone number reaches the
  next draft: name, contacts' public phone and email (**Default**: only the
  primary contact's), service area, and the address if the client has one;
- **images**: photos and a logo uploaded to the build (slice 2);
- the **files**: the site itself, plain HTML, CSS and JavaScript
  (**Confirmed**), no build step, no framework;
- its **versions**: every answer from Claude makes a new numbered version.
  Any version can be previewed and any one restored as the newest.

A client can have more than one build (a redesign, a second site).

### 2. Asking Claude

The build page is a conversation beside the preview. A request ("make the
hero darker", "add a page for towing rates") goes to Claude with the brief,
the client's facts, the names of the images, and every file of the current
version. Claude answers by writing or removing whole files and saying in a
line or two what it did. That answer becomes the next version.

- **One request, one call to the API.** No agent loop, so the cost of a
  request is known before it is sent (section 4).
- The request runs in the background. The page shows "Claude is working"
  and updates when the version is ready. Only one request per build at a
  time.
- Claude may only write files under the build: text files of the kinds a
  static site uses (`.html`, `.css`, `.js`, `.json`, `.svg`, `.txt`,
  `.xml`, `.webmanifest`), paths without `..`, a leading `/` or a part
  starting with a dot, at most 60 files and 400,000 characters of text in a
  version, with an `index.html` once there are any files. An answer that breaks a rule is
  refused whole, the request is marked failed, and its cost still counts.
- **Default:** the site Claude writes follows the 0003 content shape from
  the start: `content/site.json` holds the notice, the gallery and the
  reviews, and the pages read it. So a client can edit their own gallery
  once the site is live, with nothing rebuilt.
- What Claude is told about the site's quality is fixed in HQ's code, not
  editable: accessible, works on a phone first, fast, no outside scripts or
  fonts, real text not images of text, and nothing invented about the
  business (no made-up reviews, prices, awards or years in business).
  Where a fact is missing it writes a clearly marked placeholder.

### 3. The preview

The newest version shows in a frame beside the conversation, at phone,
tablet or full width. It is served by HQ at a staff-only address:

- Only people with `site.build` can open it. The frame is sandboxed into
  an origin of its own, so the browser sends it no cookies; its address
  carries the right instead: the build, the version and an expiry an hour
  away, signed with HQ's secret. Only the build page, which checks
  `site.build`, makes one.
- It is **sandboxed**: the frame has `sandbox="allow-scripts"` and the
  response carries `Content-Security-Policy: sandbox allow-scripts`, so the
  page runs in an origin of its own, cannot read HQ's cookies or pages, and
  cannot submit forms or open windows. It may load only its own files and
  its build's images.
- It is never public. Showing a client is done by publishing (slice 4) or
  by downloading the zip.

This keeps decision 0003's rule: HQ never serves a client's public site.

### 4. Money: the model and the hard stop

- **The key** is `HQ_ANTHROPIC_API_KEY`, set on Railway. It never goes in
  the database, a page or a log.
- **The model and the monthly cap** are in **Site builder → Model and cap**
  (`/builder/settings`).
  Only the person whose email is `HQ_SITE_BUILDER_OWNER` (Mikey) can
  change them; other admins see them. **Default**: an environment setting
  names the owner, because HQ has no role above admin and Jayanti will be
  an admin too.
- The cap starts at **$10 a month** (**Confirmed**), counted from the 1st,
  business time zone.
- **The hard stop is checked before a request is sent, at its worst
  case**: what this month has spent, plus the input sent, plus the most
  output the request may produce (`max_tokens`), each at the model's
  price. If that would pass the cap, the request is refused and the page
  says how much is left. So the cap is never crossed, not even by the last
  request.
- After the answer, the **real cost** from the API's own usage figures is
  recorded against the build, the person and the month.
- Prices are kept in HQ's code per model (as of 2026-11-25: Opus 5.5 $4
  in and $20 out per million tokens, Sonnet 5.5 $2 and $10, Haiku 5.5
  $0.10 and $0.50 up to 100K input tokens, Fable 5.2 $8 and $40). A model
  HQ has no price for cannot be chosen. **Default:** Opus 5.5 to start.
- **Default:** Settings shows spend this month, by person and by build,
  and the last six months.

### 5. Starting points

All four are **Confirmed** and can be combined:

1. **The client's HQ record** (section 1), always included.
2. **A written brief.**
3. **Uploaded photos and a logo** (slice 2): shrunk in the browser before
   upload as in decision 0003, with what each shows required. Claude gets
   their names, sizes and descriptions, not the pictures themselves.
   **Default**: no images sent to the model, to keep requests cheap; a
   later change can send small copies. A logo is shrunk to 800 pixels and
   kept a PNG, so its see-through background survives. A build holds up to
   30 pictures. Removing one leaves any version that shows it with a
   missing picture until Claude is asked to take it off.
4. **An existing site to rework** (slice 3): its repository, read through
   GitHub with `HQ_GITHUB_TOKEN` (text files of the kinds above become the
   first version; images become the build's images), or its public address,
   whose pages HQ fetches once as text. **Default**: an address is read for
   its home page and up to 10 pages it links to on the same site, only over
   https, and never an address that resolves to a private network.

   As built (slice 3): a repository that is already a plain static site (an
   `index.html` at its top, no `package.json`, no framework files) becomes
   version 1 as it is, and Claude is then asked to rework it. Anything else
   (a React, Vue or Zubra project, or an address) is kept as reference text,
   at most 150,000 characters, the home page and readme first, and goes
   with each request only until the build has files of its own. A
   repository's pictures (up to 30, each up to 3 MB) become the build's,
   at their old paths so the old pages still show them, described "From
   the old site: …" until someone says better. Pictures are not copied
   from an address. Nothing is saved when the old site can't be read.

### 6. Going live

Both are **Confirmed**, chosen on the build page by `site.build`:

- **A new repository** under Potomac-Solutions, named from the client
  (`<client>-site`, changeable), private by default. HQ creates it,
  commits the version as its first commit to `main`, and sets the client's
  site up for editing under decision 0003. The host (Railway or Netlify) is
  connected to the new repository by hand. **Default**: creating a
  repository needs a second token, `HQ_GITHUB_ADMIN_TOKEN`, with
  "Administration: read and write" on the organization, so the everyday
  token keeps only "Contents".
- **A client's existing repository**: HQ commits the version to a new
  branch, `hq/site-builder-<version>`, and opens a pull request into the
  branch the site deploys from. **Default: never straight to the deploy
  branch**, because the repository may hold work HQ didn't make (a
  framework build, a README). Merging is done on GitHub.

Each publish is one commit and records which version went out. Publishing
again sends the newest version the same way.

The **zip** of any version can be downloaded at any time from slice 1, for
a client who wants to host it themselves.

As built (slice 4): the organization is `HQ_GITHUB_ORG`, Potomac-Solutions
unless set. A new repository's later versions are committed straight onto
its main branch, since nothing but the builder writes there; a client's
own repository gets a new branch and pull request for every version. A
version is published once. The files go at the top of the repository,
beside whatever is there, and the build's pictures with them. Opening a
pull request needs `HQ_GITHUB_TOKEN` to have "Pull requests: read and
write" on that repository as well as "Contents". After a new repository is
made, HQ tries to set the client's site up for editing (decision 0003),
which works only if `HQ_GITHUB_TOKEN` can see the new repository and the
client has no site set up yet; otherwise it's done by hand on the client's
page.

## Data

Migration `0056-site-builder.sql`:

- `build`: client, name, brief, who started it, timestamps. Whether it is
  working is read from its requests. The repository and branch are added
  with slice 4.
- `build_version`: build, number, made by (a person or `claude`), the
  request that made it, Claude's summary, the files as one JSON object,
  total size.
- `build_request`: build, person, the text asked, model, state (`working`,
  `done`, `failed`), reserved cost, input and output tokens, real cost in
  micro-dollars, error, timestamps. A request refused before sending (over
  the cap, no key) is never recorded. One left working 20 minutes, lost
  when HQ restarted, is failed and counted at what it reserved.
- `build_image` (slice 2): build, path, type, width, height, what it
  shows, bytes.
- `builder_settings`: the model and the cap, one row.

Decision 0008's unmerged task-keys migration also planned to take 0056.
When 0008 resumes it takes the next free number.

## New permissions

| Permission | Admin | Manager | Member | Client |
| --- | --- | --- | --- | --- |
| `site.build`: see builds, start one, ask Claude, restore a version, download, preview, publish | Yes | No | No | No |
| Change the model and the cap | Only `HQ_SITE_BUILDER_OWNER` | No | No | No |

Admins only, because it spends Potomac's money (the Nov 23 "owner level").

## Slices

1. **Builder core**: the migration; builds from a client and a brief;
   asking Claude; versions, restore; the sandboxed preview; the zip; the
   model, the cap and the hard stop; Settings → Site builder.
2. **Images**: upload photos and a logo to a build; the preview and the
   zip carry them.
3. **Rework an existing site**: start a build from a repository or an
   address.
4. **Going live**: a new repository, or a pull request to an existing one;
   linking to decision 0003's editing.

## Consequences

- HQ calls `api.anthropic.com`. If it can't be reached, the request fails
  and is not charged; the build stays as it was.
- A site is as good as the brief and the model. Every version still needs
  a person to look at it before it goes live, which the preview and the
  pull request are for.
- Every version keeps a full copy of the files: a 200 KB site asked 50
  times is 10 MB in the database and its backups. **Default:** keep them
  all; a later change can prune old versions.
- `api.anthropic.com` is the only place HQ sends a client's facts and brief
  that it didn't before. Anthropic's commercial terms do not train on API
  data. **Default:** nothing more private than what the public site would
  show is sent: no deal values, notes, invoices or call logs.

## Rejected

- **An agent that runs commands and loops until done.** Its cost is not
  known in advance, so the hard stop could only stop it halfway.
- **Generating a Zubra project.** The preview would need a build inside
  HQ on every request. Mikey chose plain files.
- **HQ hosting the sites at `*.potomac.solutions`.** It reverses decision
  0003: a client's public site would depend on HQ, one container, being up.
- **The model choice for every admin.** Asked for as Mikey's alone.
