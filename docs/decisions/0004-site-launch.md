# 0004. Opening a client's website, and closing it

Status: decided 2026-11-23 at Mikey's request ("press a button on my end
(or the user at Nu-Finish) to have the site enter an under construction /
maintenance mode, or coming soon … they should be able to set their go
live date … and preview it at their leisure"). Built by Claude. The choices
marked **needs approval** are his to confirm.

## Context

Nu Finish's site is built but will not open until January 1, 2027. Until
then its owners want to keep working on it (decision 0003) and to see it,
while visitors see "coming soon". Later, any client should be able to
close their site for a while and reopen it.

The sites are static: files on a host, rebuilt on each commit. There is no
server to ask "is it time yet?" or "who is this?".

## Decision

The site's content file gets a `launch` block, written by HQ:

```json
"launch": {
  "mode": "coming-soon",
  "opensAt": "2027-01-01T05:00:00Z",
  "timeZone": "America/New_York",
  "message": "Call us in the meantime.",
  "previewKeyHash": "…"
}
```

The site's own code reads it in the visitor's browser:

- `mode` is `live`, `coming-soon` or `maintenance`. Missing means live.
- While it is not live and `opensAt` has not come, the visitor gets a
  holding page with how to reach the business, and search engines are
  asked not to list it.
- At `opensAt` the site opens by itself, in a page already open too. No
  commit, no deploy, and nothing that depends on HQ being up at midnight.
- `/?preview=<key>` shows the real site to whoever holds the link. The
  site hashes the key and compares it with `previewKeyHash`. The browser
  remembers it until "See what they see".

| Question | Answer |
| --- | --- |
| Who can change it | The client, for their own site, and anyone at Potomac with `site.publish` |
| Does a client's change wait to be checked | **No. It takes effect at once.** This is the one thing a client changes on their site without Potomac checking it first: it was asked for as a button either side can press. Admins are emailed. **Needs approval** |
| What goes out with it | The status and nothing else. Changes still waiting to be checked stay waiting |
| The opening time | A day and a time in the business time zone. One already gone is refused: choose "The website" to open now |
| The preview link | Made by HQ the first time a site is closed. HQ keeps the key; the site's repository holds only its hash. It needs the site's own address, which Potomac sets |
| If the link gets passed on | "Make a new preview link". The old one stops working |

## What this is not

**A curtain, not a lock.** A static site's files are public. The holding
page is drawn by code that also holds the real site, so someone who reads
the page's code can see what is behind it, and someone who sets their
device's clock forward opens it early on their own device. For a business
whose unfinished site holds nothing secret, that is fine. A site that must
not be seen at all before launch needs the host's password protection.
**Needs approval.**

It is also not a server answering "503, back soon": to a search engine a
closed site is a page that says not to list it.

## What a site has to do

Read `launch` from its content file before drawing anything, as
the Nu Finish site does in `src/launch.js` and `src/App.jsx`. A site that
does not is unaffected by the block and always open. HQ cannot tell which
kind a site is, so setting a status on one that ignores it does nothing.

## Rejected

- **HQ commits "live" at the opening time.** The opening would then wait
  on HQ being up, GitHub answering and the host rebuilding, all at
  midnight on a holiday. The site switching by itself needs none of them.
- **Build the holding page alone until launch, so the real site is not in
  the public files.** A real lock, but then a preview needs a second
  deployment and the opening needs a rebuild at the right minute. Both
  depend on the host, and differ between hosts.
- **The client's status change waits for approval, like their photos.**
  Asked for otherwise. Closing your own site for a morning should not need
  someone else.
