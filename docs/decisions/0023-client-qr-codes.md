# 0023. QR codes a client prints, counted from their own site

Status: decided 2026-11-27 at Mikey's request, written as a client: "I want
to be able to generate a QR code to put on my business cards or flyers with
different referral codes that are trackable in my dashboard. They shouldn't
route through HQ, they should route from my actual site, so if I change
providers or if HQ is down they still work." The choices he didn't make are
marked **Default**: Claude's pick, to be confirmed or changed in review.

## What was there

- Referral links (`/r/<code>`) are Potomac's own: a printed code opens HQ,
  HQ counts the scan and sends the person on. If HQ is down, the card is
  dead, and a client who leaves Potomac has cards that point at Potomac.
- A client had no way to make a code for their own cards or flyers, or to
  see whether the flyer at the diner brought anyone in.

## Decision

### 1. The code is an address on the client's own site

- A code holds `https://<their site><page>?ref=<code>`, for example
  `https://betterdaystowing.com/?ref=card-spring`. Scanning it opens their
  site directly. HQ is never in the way, so the card works when HQ is down,
  and keeps working if they move hosts or leave Potomac, as long as the
  page exists.
- The site must be one HQ knows is theirs: their website's address (Website
  content), a monitored site, or their free landing page. A client with
  none sees "Ask us to add your website's address".
- Because the address is printed, **the page and the code never change**
  once made. The label can.

### 2. Counting happens on their site, reported to HQ

- A small script goes on the site, once, in its shared layout. It has no
  dependencies and loads nothing from HQ. Potomac adds it; HQ shows it to
  copy on the client's QR codes page in HQ.
- When a page opens with `?ref=`, the script takes `ref` out of the address
  bar (so a reload, bookmark or shared link isn't counted again), and tells
  HQ "a scan of this code". It keeps the code for the rest of that visit and
  tells HQ when the person taps a phone, text or email link: what a towing
  company most wants to know.
- **If HQ is down**, the page is untouched. **Default:** the script keeps
  the reports it couldn't send in the visitor's browser (up to 20, for 7
  days) and sends them, with when they happened, on their next visit to the
  site. A scan from someone who never comes back while HQ is down is lost.
  That is the honest limit of not routing through HQ.
- HQ counts a report only when it comes from a browser on one of that
  client's own sites (the request's Origin), for a code that client made.
  Programs (link previews, crawlers) aren't counted.
- **Default:** the same visit's scan, or tap, of the same code counts once
  in 30 minutes. A visit is a random word the script keeps for that browser
  tab (not a cookie), because phones on one mobile network often share a
  network address, and the address alone would count many people as one.
  HQ keeps only the code, what happened and when. Nothing about the
  person, no cookie, no address: the 30-minute check is a one-way hash that
  expires with the window, as HQ's rate limits already do.

### 3. Making codes

- In the portal, under **QR codes**: anyone with portal access at that
  client. In HQ, on the client: `site-qr.manage`.
- A code has a **label** ("Business cards, spring 2027"), a **page** on the
  site (**Default:** the home page), which site if they have more than one,
  and an optional **code** (2 to 32 lower-case letters, digits and hyphens).
  Left empty, HQ makes a six-character one. A code is unique within a
  client.
- **Default:** up to 100 codes per client.
- A code nobody has scanned can be removed. One that has been scanned can
  be **retired**: hidden under "Retired", still counted, and brought back
  at any time, since printed cards may still be out there.
- Download as **SVG** (sharp at any size, for Canva or a designer) or
  **PNG** (1,200 pixels square, for print shops that won't take SVG).

### 4. The dashboard

- Portal → **QR codes**, and the same page in HQ for the client: each code
  with its label, address, scans in the last 30 days and all time, taps to
  call, text and email after a scan, and when it was last scanned.
- HQ's page also shows the script and **when HQ last heard from the site**,
  so a site where the script went missing is noticed.

## Not in this

- Forms on the client's own site: they aren't HQ's, so a filled-in form
  isn't credited to a code. A tap to call, text or email is.
- QR codes in the monthly report to plan clients. A line there is a small
  follow-up.
- Changing where a printed code goes. Only a code that goes through a
  server can be pointed elsewhere later, and that's exactly what this
  avoids.

## Data

- Migration 0092: `site_qr_code` (client, code, label, site, page, retired
  or not, who made it) and `site_qr_event` (code, kind, when); and the new
  permission.
- Events: `site-qr.created`, `site-qr.renamed`, `site-qr.retired`,
  `site-qr.restored`, `site-qr.removed`. A scan or tap writes no event, as
  with referral links: its own row is the record.

## New permission

| Key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- |
| `site-qr.manage` | Yes | Yes | Yes (**Default**) | Their own client's, in the portal |

Seeing a client's codes in HQ needs `client.view`.
