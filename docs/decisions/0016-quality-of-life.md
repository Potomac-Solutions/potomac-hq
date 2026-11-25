# 0016. Quality of life: for everyone, for managers, and for clients

Status: decided 2026-11-25 at Mikey's request. Claude proposed nine
improvements; Mikey answered "do all 9 of these in a logical order". The
choices he didn't make are marked **Default**: Claude's pick, to be confirmed
or changed in review. Built on the branch after decision 0015.

## Decision

### 1. System status (admins)

`/status`, under Company: whether backups, email, AI and the server's
settings are working, the newest errors, and what HQ runs on (version,
start time, database size, migrations). Backups and the database are read
from HQ itself; errors and emails are counted since HQ last started.
**Default:** errors are kept in memory, ten at most, so nothing new is
stored; the full error still goes to the log and the alert email.

### 2. What changed here

Clients, deals, invoices, tasks and proposals end with **What changed
here**: the record's newest 15 events from the activity log, folded until
opened, for anyone who may see the record. Projects already had their
history.

### 3. Notice settings

On Notices, for each kind (a task given to you, a mention, a reminder):
email it right away, in a 7 AM digest, or never. And quiet hours, when
nothing is emailed or pushed; it waits until they end. The bell always
shows everything. Migration 0076.

### 4. Many at once

All work has a box on each row and **With the ticked ones**: move to a
status, give to someone, make due, or add a label, at most 100 at once.
Each goes through the task's own command, so its checks and event are as
if done one by one. A project's Money page can mark several draft
invoices sent at once, after ticking "I've checked the ticked drafts".
**Default:** reminders aren't a bulk action yet.

### 5. Team workload (`report.view`)

`/workload`, under Work: each person's open tasks, due this week, overdue,
and hours this week against their own usual week (the four before,
averaged), whoever needs a look first. **Default:** "needs a look" is
anything overdue, more than 8 due this week, or 25% over their usual hours
so far this week.

### 6. View as a role (admins)

On People, **View as a manager** or **View as a member**: HQ answers with
that role's permissions, for that admin only, until they press **Stop
viewing** (or after four hours). Every change is refused while it lasts.
The cookie only names the role; whether to honour it is decided on every
request from the admin's real access.

### 7. The weekly owner email

Mondays at 7:23, to each active admin: last week's money in and out, what's
still owed and overdue, new, won and lost deals, projects at risk, overdue
tasks and this month's AI spend, with links. Demo clients are left out.
Never sent twice for one week. **Default:** every admin gets it; there's no
switch yet.

### 8. HQ on a phone, with alerts

HQ can be installed to a home screen (a manifest, icons and a service
worker that keeps no copies of pages). On Settings, **Turn on alerts on
this device**: HQ then pushes an alert when a client writes or asks for a
call, a site goes down (admins and a project's owner), a booked call is 15
minutes away (its host), and for each notice. Quiet hours hold them; one
older than 12 hours is dropped. Web Push is written by hand on
`node:crypto` (RFC 8291 and 8292), with no package. Needs
`HQ_VAPID_PUBLIC_KEY` and `HQ_VAPID_PRIVATE_KEY` (`npm run
push:keygen`). Migration 0077.

### 9. The portal: sign-in links and approving from email

The portal's sign-in page has **Email me a link**: a client gets a one-time
link (a week) to sign in and choose a password, so self-serve password
reset (left out at v0.6) is in. The answer never says whether the email has
an account. When a deliverable is shared, the client's email carries a link
per deliverable that opens it with **Approve it** and **Ask for changes**,
without signing in; it's for that person and that deliverable only, signed
with `HQ_NOTICE_SECRET`, and works for 14 days. **Default:** proposals are
still accepted in the portal, where the typed-name signature happens.

### 10. Everyday buttons (second round)

- **Notes survive a dropped signal.** What's typed in a form's text box is
  kept on the device (`localStorage`, 14 days) until it's sent, and put back
  in the empty box with "Brought back what you were typing here before."
  Signing out clears it. Nothing goes to the server.
- **Booked calls in the calendar feed**, at their times (UTC `DTSTART`),
  for their host, from two weeks back to three months ahead, each with a
  link to Get ready.
- **Undo** for ten minutes after moving a task or ticking off or putting
  back a to-do: the next page has an Undo line (a live region), for the
  person who did it, once. Migration 0078.
- **Saved replies** (`contact.edit`): written once on Saved replies, under
  Clients, and offered beside a message to a client, with `{first name}`,
  `{client}`, `{project}` and `{me}` filled in. Migration 0079.
- **Duplicate clients.** Adding a client whose name is close to one in HQ
  (business endings like LLC ignored, a small typo allowed) says which and
  asks again with "It's a different business: add it anyway". **Merge**, on
  a client's page, for managers and admins (`client.set-status` and
  `opportunity.view-value`): every row pointing at the duplicate moves to
  the one kept, found from the schema's foreign keys so new tables move
  too; the duplicate stays as a former client named "(merged)". A row that
  can't move (a second free landing page) undoes the whole merge.
- **The portal's timeline**: a client's project opens with *Waiting on
  you*, *What we're doing next* and *Done*, each linking to where it's dealt
  with.
- **A keyboard pass**: the command bar is a proper dialog (focus kept
  inside, Escape from anywhere in it, focus put back on close), with
  browser tests for that, the skip link, Undo and a brought-back draft.
  See `docs/reviews/2026-11-25-keyboard-and-screen-reader.md`.

## Not now

- A true password-free sign-in (the link sets a password first).
- Bulk reminders, and bulk actions on invoices beyond marking drafts sent.
- A switch to turn the weekly email off.
- Undo for more than task moves and to-dos (a deleted note, a status change).
- Merging contacts, as opposed to whole clients.
