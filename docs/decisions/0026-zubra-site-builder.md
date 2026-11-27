# 0026. Zubra from the site builder: starters, and "Convert to Zubra"

Status: decided 2026-11-27 at Mikey's request. Asked whether the site builder
(decision 0010) could write Zubra, he chose "Zubra starter, AI writes the
words" and asked for an option for admins to build Zubra from scratch. After
seeing what from scratch needs (somewhere safe to run components Claude
wrote, and a preview that isn't exact), he proposed instead: "What if we
made the site builder run with html css and js, but then there was a
'convert to zubra' button", and said yes to this decision being rewritten
that way. So **Convert to Zubra replaces from scratch**. The open choices
are marked **Default**: Claude's pick, to be confirmed or changed in review.
Built by Claude in the order under "Slices", one pull request into `staging`
each.

This adds to decision 0010. Plain builds work as they do today.

## Context

Potomac's hand-built client sites are Zubra projects: Better Days Towing and
Tressler's Garage are Zubra components rendered to static HTML at build
time. The site builder makes plain HTML, CSS and JavaScript, so a builder
site and a hand-built site are two kinds of thing to support.

Two facts shape this decision:

- **Models write HTML far better than `.zb`.** Building Tressler's by hand,
  the compiler refused an unknown prop, and component styles lost to the
  page's stylesheet because Zubra puts them in a cascade layer. Each such
  mistake in the builder is a paid request.
- **Zubra renders a component on the server by running its `<script>`.** A
  component Claude wrote, run inside HQ, could read HQ's secrets and
  database.

So the design work stays in plain HTML, where the model is strongest and
the preview is exact, and Zubra comes in at two fixed points: a starter HQ
ships, or one conversion at the end.

## Decision

### 1. The rule: HQ never runs component code Claude wrote

- **Compiling and checking is allowed.** `@zubra/compiler` is WebAssembly:
  checking a `.zb` file or turning it into a module runs none of the
  component's code.
- **Rendering Claude's components is not**, anywhere in HQ: not in its
  process, a worker thread or a child process.
- HQ renders only the starters' components, which are HQ's own code.
- A converted site is first built on GitHub's machines, by the pull
  request's CI (section 3), and after that by the host.

### 2. Zubra starter builds

A build has a **kind**, chosen when it is started: **plain** (decision
0010) or **starter**. **Default:** plain is preselected, as today.

A **starter** is a complete Zubra site kept in HQ's repository, under
`src/builder/starters/<name>/`: its components, a fixed build script, and a
schema for its content and theme. HQ renders starters itself with
`@zubra/server`, at the Zubra version HQ uses.

- **The first starter is `landing`**, made from the Tressler's Garage site
  with Tressler's own words, history and reviews taken out. Its sections:
  header with a top bar, hero, promises, services, a "help me choose"
  picker (Tressler's symptom picker, made general: a question, choices,
  and what each one means), reviews, a story timeline, an area call-out,
  contact with a request form, and footer.
- **Claude writes two files:**
  - `content.json`: which sections show, in what order, and every word,
    link and list in them. HQ checks it against the starter's schema; an
    answer that doesn't fit is refused whole, as 0010 refuses a broken
    one.
  - `theme.json`: the accent colour, light or dark ground, and the display
    and body fonts. **Default:** fonts come from a list HQ ships as files
    (no outside fonts, as 0010 requires); colours must pass 4.5:1 contrast
    for text or HQ refuses them.
- **0010's quality rules hold, and are stricter here:** reviews come only
  from the client's reviews in HQ (decision 0013), never from Claude. With
  none, the reviews section is hidden. Years in business, warranties and
  prices are placeholders unless they are in the brief or the client's
  record.
- **Preview:** HQ renders the starter with the build's two files and serves
  the page in 0010's sandboxed frame. It is the page the host will build.
- **Cost:** a request sends the schema, the two files and the brief, not
  whole pages, so it is cheaper than a plain build's.
- **Going live:** the whole project is published (the starter's
  components, its build script, the two files) to a new repository or as a
  pull request, as in 0010. It builds with `npm run build` into `dist/`.
  **Default:** a live site keeps the starter's components as they were at
  publishing; a later fix to the starter reaches it only when a new version
  of its build is published.
- **More starters** are added by hand in HQ's code, one pull request each.

### 3. Convert to Zubra

For a plain build, once its design is settled.

**When:** the build has been published (0010 section 6), so its repository
exists and holds the plain site. **Convert to Zubra** takes the build's
newest version and opens a pull request that replaces the plain files with
a Zubra project that builds the same pages.

**What Claude writes**, in one call:

- `src/components/*.zb`: the page's sections as components.
- `src/styles/site.css`: fonts, colours and page-wide styles.
- `src/pages.json`: each page's head (title, description, share details)
  and its sections in order, each as a component's tag and its props.
  **Default:** JSON, not a `page.js`, so no JavaScript Claude wrote runs in
  the build outside the components.
- `content/site.json`: unchanged from the plain site (decision 0003's
  shape), so the client's own edits keep working.

**What HQ writes**, and Claude can't change: `package.json` with Zubra
pinned to HQ's version, `scripts/build.mjs` (renders `pages.json` with
`@zubra/server`), the comparison test below, the CI workflow, the README,
and **Default:** a `netlify.toml` setting the build command and `dist`.
A site on another host has those two settings changed by hand before the
pull request is merged; the pull request says so.

**What Claude is told about Zubra** is a reference kept in HQ's code,
pinned to HQ's Zubra version: the `.zb` format, props, `zb-each` and
`zb-if`, events, and the two rules found the hard way (every prop declared
on the root tag; page-wide styles go in the `base` layer). It is sent with
the conversion call only, never with ordinary requests.

**Checking, and one repair.** HQ runs `zubra check` on every component. If
it finds errors, HQ sends Claude one more call with the errors and the
compiler's suggested fixes. If that still fails, no pull request is opened;
the conversion is marked failed with its errors shown, and its cost counts.
**Default:** one repair, never more. The hard stop reserves the worst case
of **both** calls before the first is sent; if both don't fit under the
cap, the conversion is refused.

**The comparison.** The plain version is the reference. The pull request
carries its pages under `reference/`, and CI builds the Zubra project and
compares each built page with its reference:

- **Must match, or CI fails:** the visible text in order, headings and
  their levels, links and where they go, images and their descriptions,
  form fields and their labels, the title and description.
- **Default: reported, not failing:** a screenshot of each page at phone
  and desktop width beside the reference's, with how much differs, posted
  on the pull request. A person looks before merging.

The pull request is merged on GitHub, as 0010 requires for a client's
repository. **Default:** a repository HQ made also gets a pull request for
a conversion, not a commit to `main`, so CI's verdict comes first.

**After converting, the repository is a Zubra project.** It is one-way:

- Changes are made in the repository by hand, like Better Days and
  Tressler's.
- HQ refuses to publish a plain version to it, since that would overwrite
  the Zubra project.
- The build stays in HQ, and Claude can still be asked for new plain
  versions there. **Convert again** takes the newest one and opens a new
  pull request that replaces the Zubra project whole. Hand changes made in
  the repository since are lost unless carried over; the page and the pull
  request both say so.

### 4. Reworking an existing Zubra site

0010 slice 3 keeps any Zubra repository as reference text. That stays: the
builder never edits a Zubra project's components.

## Data

Migration `0095-zubra-builds.sql`:

- `build.kind`: `plain` or `starter`. Builds made before this are `plain`.
- `build.starter`: the starter's name, for a starter build.
- `build.converted_at`: when a conversion's pull request was first opened.
- `build_conversion`: build, version, who asked, state (`working`,
  `failed`, `opened`), the compiler's errors, the pull request's address,
  timestamps.
- `build_request.conversion` and `build_request.repair_of`: a conversion's
  calls are recorded as requests, so their cost counts against the cap and
  shows in the spend by build.

## New permissions

| Permission | Admin | Manager | Member | Client |
| --- | --- | --- | --- | --- |
| `site.build` (0010): now also starts starter builds | Yes | No | No | No |
| `site.build.convert`: convert a build to Zubra, convert again | Yes | No | No | No |

Today both go to the same people, since admin is HQ's owner level.
**Default:** they are separate anyway, so if `site.build` is ever given to
managers, converting stays with admins.

## Slices

1. **Starters**: the migration, the build's kind, the `landing` starter
   made from Tressler's, `content.json` and `theme.json` with their checks,
   the starter preview, choosing the kind when starting a build.
2. **Publishing starter builds**: the whole project into a new repository
   or a pull request.
3. **Convert to Zubra**: the Zubra reference, the conversion call, the
   check and the one repair, HQ's fixed project files, the pull request.
4. **The comparison**: the reference pages, the test that must match, and
   the screenshots on the pull request.
5. **Convert again**, and refusing plain publishes to a converted
   repository.

## Consequences

- HQ's repository carries client-facing site code (the starters). It's
  covered by HQ's tests and CI, including a browser test that renders each
  starter with sample content.
- For a static page, a visitor gets the same HTML before and after
  converting. What converting buys is on Potomac's side: every client
  repository has one shape, sections can be reused, and Zubra gets real use.
- A conversion is a paid call that can fail twice and open nothing.
- HQ doesn't see a converted site until CI has built it. The preview in HQ
  stays the plain version, which the comparison holds the Zubra one to.
- A client's repository needs GitHub Actions on for the comparison to run.
- HQ's Zubra version is the builder's. Upgrading Zubra in HQ means checking
  every starter and the reference Claude is given.

## Rejected

- **Zubra from scratch** (Claude writing components request by request).
  Asked for first, then replaced by converting. It needs either a preview
  that runs the components only in the browser, which isn't what visitors
  get, or a separate renderer service with no secrets to build each
  version. If it is wanted later, the renderer service is the way.
- **Rendering Claude's components in HQ**, even in a worker thread or a
  child process. Neither is a security boundary.
- **The plain version as the master copy, converted on every publish.**
  Each publish would cost a call, and each conversion may split the
  components differently, so the repository's history would be noise.
- **Claude writing `page.js`.** It's JavaScript the build runs with
  everything the build has. `pages.json` gives the same layout as data.
- **Unlimited repair calls.** The cost isn't known in advance, which is why
  0010 rejected an agent loop.
