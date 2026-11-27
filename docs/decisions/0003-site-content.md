# 0003. How a client changes their own website

Status: decided 2026-11-23 at Mikey's request ("a tooling system … that
allows the owners the ability to directly update images in the photo
gallery, and more", then "go ahead and handle this"). Built by Claude. The
choices marked **needs approval** below were made while building and are
his to confirm.

## Context

Potomac builds client websites as static sites: a repository on GitHub, a
host that rebuilds on every commit. Nu Finish Collision Center is the
first. Its owners want to change their gallery photos themselves, and
other things that go stale: a holiday notice, customer reviews.

HQ already has what this needs on the people side: client users who sign
in to the portal and are tied to one organization, a place for uploads,
permissions, and an activity log.

## Decision

**HQ publishes to the site through Git. The site never reads from HQ.**

1. The site keeps the content a client may change in one JSON file in its
   repository (`src/content/site.json` on Nu Finish), and its photos in
   one folder (`public/gallery`).
2. A client changes that content in the portal, under "Your website". HQ
   keeps their changes as a draft. They send it in when done.
3. Someone at Potomac with `site.publish` checks it and publishes. HQ
   makes one commit to the site's repository: the content file, any new
   photos, and the removal of photos no longer used.
4. The site's host rebuilds from that commit, as it does for any other.

| Question | Answer |
| --- | --- |
| What if HQ is down | The site is unaffected. It is still a static site with its content in its own repository |
| Who can put something on a site | Only someone with `site.publish` (admins and managers). A client's changes always wait for that. **Needs approval**: the alternative is letting clients publish directly |
| What a client can change | Gallery photos (add, remove, reorder, title, caption, what the photo shows), one notice line, and reviews. Nothing else. **Needs approval** |
| Whose site | A client user's own organization's, taken from their session and from nothing they send. A client has one site |
| Where the source of truth is | The repository. HQ holds a copy of what it last read or published. "Read the site again" refreshes it after a change made there by hand |
| How GitHub is reached | `HQ_GITHUB_TOKEN`: a fine-grained personal access token with "Contents: read and write" on the client sites' repositories only. Behind a `SitePublisher` port with one adapter (tool-boundaries rule 5) |
| Who the commit is by | The token's owner. The message lists the changes and ends "Published from Potomac HQ." |
| Which branch | The one given when the site is set up. For a site that deploys from `main`, that is `main` |

Added the same day: whether the site is open at all is a separate matter
with a different answer, in `0004-site-launch.md`.

## The content file

```json
{
  "notice": "Closed Thursday and Friday for Thanksgiving.",
  "gallery": [
    { "id": "…", "src": "/gallery/paint-booth.webp", "alt": "…", "title": "…", "caption": "…", "focus": "50% 22%" }
  ],
  "testimonials": [{ "quote": "…", "by": "…" }]
}
```

- `gallery` must be there, with at least one photo. `notice` and
  `testimonials` may be missing.
- HQ gives each photo an `id` the first time it publishes.
- Anything else in the file, and any other field on a photo (`focus`
  above), is carried through and written back as it was. A site can add
  fields HQ knows nothing about.
- A file in any other shape is refused when the site is set up. Nothing is
  half read.

A site built by Potomac that wants this feature keeps its content in this
shape. The page code reads the file and decides how it looks.

## Photos

- **Shrunk in the browser before upload**, to 1,600 pixels on the long
  side, as a JPEG. A phone's photo is 5 to 12 MB, far too big for a web
  page, and HQ has no image library (and wants none: decision 0001 keeps
  its dependencies few). Re-drawing the photo also drops its location and
  time. **Needs approval**: the alternative is a build step in each site
  that converts whatever arrives.
- HQ refuses a photo over 3 MB, so one that was not shrunk (scripts off,
  an old browser) never reaches a site. The message says to try a current
  browser.
- A photo's type is decided by its first bytes: JPEG, PNG or WebP.
- Its file name on the site is made by HQ from its id (`hq-0190a0001234.jpg`).
  Nothing a client types reaches a path.
- **What the photo shows** (its alt text) is required. The person
  publishing is asked to check it.
- Photo bytes are kept in the database, in `content_photo`, for the same
  reasons as decision 0002: one file to back up and restore. A site's
  existing photos are read from its repository when it is set up, so the
  portal can show them. HQ's content policy allows images from HQ only.
  A removed photo's bytes are deleted from HQ once the removal is
  published.

## What was not built

- **Hours, services and prices.** Hours are also in the site's
  search-engine data, in a structured form, and the two must change
  together. (Before and after pairs were here too; they were added on
  2026-11-27, below.)
- **A preview of the site with the changes.** The person publishing sees
  the list of changes and each photo, not the page.
- **Undoing a publish from HQ.** Revert the commit on GitHub, then "Read
  the site again".
- **More than one site for a client.**

## Consequences

- A client's change is on their site a minute or two after it is
  published, not at once: the host has to rebuild.
- Publishing needs GitHub. If GitHub refuses or cannot be reached, the
  changes stay waiting and the page says why.
- If the branch is protected against direct pushes, publishing is refused.
  The token's owner must be allowed to push to it.
- Each new photo adds a few hundred kilobytes to the site's repository and,
  until it is removed, to HQ's database and backups.
- A change made to the content file by hand is replaced by the next publish
  unless HQ reads the site again first. The site's README says so.

## Rejected

- **The site loads its content from HQ when a visitor opens it.** A
  client's public site would then depend on HQ being up, and HQ is one
  container. It would also need HQ to serve files to the public, which it
  never does.
- **A hosted CMS.** Another account for the client, another bill, and
  nothing in it that HQ's portal does not already have.
- **Clients commit to GitHub themselves.** They would need accounts and to
  learn it.

## Added 2026-11-27: before and after pairs

At Mikey's request ("the nu-finish site has a before and after gallery that
is more important to allow the users of that site access to so they can
update on their own", then "lets do it all at once"). Built by Claude.

A site that shows before-and-after pairs keeps them in its content file:

```json
"beforeAfter": [
  {
    "id": "…", "title": "Ford F-250 Super Duty", "caption": "Front bumper and fender",
    "before": { "id": "…", "src": "/gallery/f250-before.webp", "alt": "…", "srcSet": "…" },
    "after":  { "id": "…", "src": "/gallery/f250-after.webp",  "alt": "…" }
  }
]
```

- **Only a site whose file has `beforeAfter`** shows the section in the
  portal and in HQ. A site without it gains none. An empty list is a site
  with the section and no pairs in it: the page hides the section.
- **What stood in the way was sizes.** It no longer does: a pair's photo
  needs only `src`. A site may name other sizes in `srcSet`, which HQ
  carries through. A pair HQ adds has one size, shrunk in the browser like
  any photo (both photos at once); the page shows it at every width.
- A pair is added with **both photos and its words together**, or not at
  all. Its title, what was done, and what each photo shows can be changed;
  pairs can be moved and removed. Unlike the gallery, the last pair can
  go. Up to 20.
- **Removing a pair, once published, removes its photos** from the
  repository, and the other sizes its `srcSet` names, if they are there.
- A pair's photos are kept in `content_photo` like the gallery's.

**Rolling it out to a site that already has HQ set up:** HQ only knows the
pairs once it has read the file with them. Until "Read the site again" is
used, HQ's own copy of the file has no `beforeAfter`, and a publish or a
status change from HQ would write the file without it. So: merge the
site's change, then "Read the site again" at once, before anything else is
saved for that site.

