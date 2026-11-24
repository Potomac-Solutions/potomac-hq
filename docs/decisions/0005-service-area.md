# 0005. Where a client's business goes: its service area

Status: decided 2026-11-23 at Mikey's request, for Better Days Towing ("it
should be more of a polygon type so he or I can set the areas he is
generally willing to travel to as its not specifically county based", with
both picking counties and drawing, "live as soon as he submits/saves").
Built by Claude. The choices marked **needs approval** are his to confirm.

## Context

A towing company, a mobile mechanic or a cleaner goes out to customers, and
customers want to know whether it will come to them. Better Days Towing's
site shows a map of where it goes. The owner should be able to change that
map himself, in the portal, the way Nu Finish's owners change their photos
(decision 0003).

Where a business goes is rarely a list of counties. It is "Garrett and
Allegany, and over the line as far as Kingwood": partly whole counties and
partly a shape.

## Decision

The site's content file gets a `serviceArea` block, written by HQ:

```json
"serviceArea": {
  "areas": [
    { "name": "Garrett County", "county": "24023", "ring": [[-79.4762, 39.7211], …] },
    { "name": "Deep Creek Lake and around", "ring": [[-79.42, 39.48], …] }
  ]
}
```

An area is a name and an outline: a list of `[longitude, latitude]` points,
not closed. `county` is the five-digit FIPS code when the area is that whole
county. The site draws the areas on its own map. It decides how they look.

| Question | Answer |
| --- | --- |
| How an area is made | Picking a whole county on the map (or in the list under it), or drawing: a click for each point, then a name |
| Where a county's outline comes from | HQ's own copy of the Census Bureau's county boundaries (`src/websites/infrastructure/counties.json`, made by `tools/counties/make.mjs`), never from what the browser sends. Maryland, West Virginia, Virginia, Pennsylvania, Delaware and DC |
| Does a client's change wait to be checked | **No. It takes effect at once**, as one commit of the content file with the service area and nothing else, like the site's status (0004). Changes to photos, the notice or reviews still wait. Admins are told on the dashboard and by email. **Needs approval** |
| Who can change it | The client, for their own site, and anyone at Potomac with `site.publish` |
| Limits | Up to 20 areas. A drawn area needs a name and at least three points, and is refused if it spans more than 5 degrees (about 350 miles): that is a slip of the hand. Points are kept to four decimal places, about ten metres |
| Without scripts | The counties are checkboxes, so a county can be added or taken away with scripts off, by keyboard or screen reader. Drawing needs a pointer and scripts. Drawn areas are kept as they were when the form is sent without them |
| A site without the block | Has no service area to change, and the portal doesn't show one |

Added with it: **a site with no photo gallery** can be set up. Better Days
has no gallery, only a service area. A content file without a `gallery`
must hold a `serviceArea` or a `launch` block, and no notice or reviews; the
portal then shows no photos, notice or reviews to change.

## What was not built

- **A street map under the areas.** The editor draws county lines and their
  names; the site draws its own map with towns. A street map would need map
  tiles from a third party, which HQ's content policy (images from HQ only)
  and decision 0001 (few outside services) keep out.
- **Editing a drawn area's points.** Remove it and draw it again.
- **Holes, and areas made of several pieces.** A county made of several
  pieces is picked as its largest one.
- **Counties outside the six states.** Add the states to the tool and run
  it again.

## Consequences

- The site's map changes a minute or two after saving: the host rebuilds.
- Saving needs GitHub, like publishing. If it can't be reached the area is
  not saved and the page says why.
- A change made to the block by hand is replaced by the next save unless HQ
  reads the site again first.

## Rejected

- **Counties only.** Simple, and the first version of the site had it, but
  a business's reach doesn't follow county lines.
- **The client's change waits for Potomac, like photos.** Asked for
  otherwise: "live as soon as he saves".
- **Drawing on a street map from a map service.** See "What was not built".
