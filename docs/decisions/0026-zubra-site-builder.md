# 0026. The site builder writes Zubra: starters, and from scratch for admins

Status: decided 2026-11-27 at Mikey's request. Asked whether the site builder
(decision 0010) could write Zubra, he chose the recommended way, "Zubra
starter, AI writes the words", and asked to "add an option for admin/owners
to build using the zubra from scratch". The open choices are marked
**Default**: Claude's pick, to be confirmed or changed in review. Built by
Claude in the order under "Slices", one pull request into `staging` each.

This changes decision 0010, which made every site plain HTML, CSS and
JavaScript and rejected generating a Zubra project because the preview
would need a build inside HQ on every request.

## Context

Potomac's hand-built client sites are Zubra projects: Better Days Towing and
Tressler's Garage are Zubra components rendered to static HTML at build
time. The site builder can't make one. A builder site and a hand-built site
are two different kinds of thing to support, and the builder's sites don't
show off Zubra.

Models know far less about `.zb` than about HTML. Building Tressler's by
hand, the compiler refused an unknown prop, and component styles lost to
the page's stylesheet because Zubra puts them in a cascade layer. A model
writing `.zb` with no help makes those mistakes often, each one a paid
request. So the usual path keeps the components fixed and lets Claude
write only the words and the look; writing components from scratch is the
rarer, dearer path.

## Decision

A build has a **kind**, chosen when it is started and fixed after (except
by ejecting, section 4):

| Kind | Claude writes | Who can start one |
| --- | --- | --- |
| **Zubra starter** | Content and theme as JSON, for components HQ ships | `site.build` |
| **Zubra from scratch** | The components themselves, plus the page and content | `site.build.scratch` |
| **Plain** (decision 0010) | HTML, CSS and JavaScript | `site.build` |

**Default:** a new build is a Zubra starter unless someone picks otherwise.
Plain stays, so builds already made keep working and a client who wants
no build step can still have one.

### 1. The rule for both Zubra kinds: HQ never runs code Claude wrote

Zubra renders a component on the server by running its `<script>`. A
component Claude wrote, run inside HQ, could read HQ's secrets and
database. So:

- **Compiling is allowed.** `@zubra/compiler` is WebAssembly: turning a
  `.zb` file into a module, or checking it, runs none of the component's
  code. HQ compiles and checks Claude's files.
- **Rendering Claude's components on HQ's server is not.** Only the
  starters' components, which are HQ's own code, are rendered there.
- A from-scratch preview runs its components in the **browser**, in 0010's
  sandboxed frame (its own origin, `sandbox="allow-scripts"`, no cookies).
  The published site is rendered when the host builds it (Netlify or
  Railway), away from HQ.

### 2. Zubra starter

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
- **0010's quality rules still hold**, and are stricter here: reviews come
  only from the client's reviews in HQ (decision 0013), never from Claude.
  With none, the reviews section is hidden. Years in business, warranties
  and prices are placeholders unless they are in the brief or the client's
  record.
- **Preview:** HQ renders the starter with the build's two files and serves
  the page in the same sandboxed frame as 0010. Rendering takes a fraction
  of a second, so a preview is ready when Claude's answer is.
- **Cost:** a request sends the schema, the two files and the brief, not
  whole pages, so it is cheaper than a plain build's.
- **More starters** (a menu-first restaurant, a booking-first salon) are
  added by hand in HQ's code, one pull request each.

### 3. Zubra from scratch

For admins who want a site no starter fits.

- **Claude writes** `src/components/*.zb`, `src/styles/site.css`,
  `src/page.json` and `content/site.json`.
  - `page.json` lists the head (title, description, the share details)
    and the sections in order, each as a component's tag and its props.
    **Default:** a JSON page, not a `page.js`, so there is no JavaScript
    Claude wrote that HQ's build script must run beyond the components.
  - `content/site.json` keeps decision 0003's shape (notice, gallery,
    reviews), so a client can edit their own once the site is live.
- **HQ writes the rest** and Claude can't change it: `package.json` with
  Zubra pinned to HQ's version, `scripts/build.mjs`, which renders
  `page.json` with `@zubra/server` when the host builds, the tests, the CI
  workflow and the README.
- **Checking, and one repair.** After an answer HQ runs `zubra check` on
  every component. If it finds errors, HQ sends Claude one more request
  with the errors and the compiler's suggested fixes. If that still fails,
  the version is kept and marked "doesn't compile", and its errors are
  shown, so the next request can fix it by hand. **Default:** one repair,
  never more.
  - This changes 0010's "one request, one call" for this kind only. The
    hard stop reserves the worst case of **both** calls before the first is
    sent. If both don't fit under the cap, the request is refused.
- **What Claude is told about Zubra** is a reference kept in HQ's code,
  pinned to HQ's Zubra version: the `.zb` format, props, `zb-each` and
  `zb-if`, events, and the two rules found the hard way (every prop
  declared on the root tag; page-wide styles go in the `base` layer).
  **Default:** sent with prompt caching, so a build's later requests pay
  about a tenth for it.
- **Preview:** HQ compiles each component to a browser module and serves
  a preview page that builds `page.json`'s sections in the browser.
  The preview shows how the page looks. Search engines and visitors get
  the server-rendered page only after the host builds it.
- **Files:** 0010's limits hold (60 files, 400,000 characters). `.zb` is
  added to the allowed kinds for this kind of build.

### 4. Ejecting a starter

A person with `site.build.scratch` can **eject** a starter build: the
starter's components, a `page.json` made from its `content.json` and
`theme.json`, and its styles become the files of a new from-scratch
version. It can't be undone; the starter versions before it stay in the
history. This is the cheap way to start a from-scratch site: Claude changes
working components instead of writing them all.

### 5. Going live

As in 0010, a new repository or a pull request to the client's existing
one. A starter build publishes as a whole project: the starter's
components, its build script and the build's two files. A from-scratch
build publishes its files and HQ's fixed ones. Either way the repository
builds with `npm run build` into `dist/`, as Tressler's does.

**Default:** a starter site keeps the starter's components as they were at
publishing. A later fix to the starter in HQ reaches a live site only when
someone publishes a new version of its build.

### 6. Reworking an existing Zubra site

0010 slice 3 keeps any Zubra repository as reference text. **Default:** it
stays that way. A repository can't become a starter build, and only one in
the from-scratch shape (`src/page.json` and `src/components/`) becomes a
from-scratch version 1. Others are reference text, and Claude rebuilds them.

## Data

Migration `0095-zubra-builds.sql`:

- `build.kind`: `plain`, `starter` or `scratch`. Builds made before this are
  `plain`.
- `build.starter`: the starter's name, for a starter build.
- `build_version.compiles`: yes, no, or not checked (plain). The errors are
  kept with it.
- `build_request.repair_of`: the request a repair call follows, so both
  calls' costs count as one request.

## New permissions

| Permission | Admin | Manager | Member | Client |
| --- | --- | --- | --- | --- |
| `site.build` (0010): now also starts Zubra starter builds | Yes | No | No | No |
| `site.build.scratch`: start a from-scratch build, eject a starter | Yes | No | No | No |

Today both go to the same people, since admin is HQ's owner level. **Default:**
they are separate permissions anyway, so if `site.build` is ever given to
managers, building from scratch stays with admins.

## Slices

1. **Starters**: the migration, the build's kind, the `landing` starter
   made from Tressler's, `content.json` and `theme.json` with their
   checks, the starter preview, and choosing the kind when starting a
   build.
2. **Publishing starter builds**: the whole project into a new repository
   or a pull request.
3. **From scratch**: the Zubra reference, `.zb` files, the check and the
   one repair, the browser preview, HQ's fixed project files, publishing.
4. **Ejecting** a starter build.

## Consequences

- HQ's repository carries client-facing site code (the starters). It's
  covered by HQ's own tests and CI, including a browser test that renders
  each starter with sample content.
- A starter's quality is set by hand, once, and every site made from it
  shares it. A bug in a starter is fixed once, but reaches live sites only
  when they are published again.
- A from-scratch site can't be previewed exactly as visitors will see it
  until the host builds it. The preview is close, not identical.
- HQ's Zubra version is the builder's. Upgrading Zubra in HQ means checking
  every starter, and new from-scratch builds use the new version.

## Rejected

- **Rendering Claude's components on HQ's server**, even in a worker
  thread or a separate process. A worker isn't a security boundary, and a
  sandboxed process with no secrets, files or network is more to build and
  keep right than a browser preview.
- **Claude writing `page.js`.** It's JavaScript that the build runs with
  everything the build has. `page.json` gives the same layout as data.
- **Unlimited repair calls.** The cost isn't known in advance, which is why
  0010 rejected an agent loop.
- **Retiring plain builds.** They are already in use, and they are the
  right choice for a client who wants files with no build step.
