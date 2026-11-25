# Data model: after 1.0

Records added after the v1.0 roadmap, each decided while building and marked
with whether it needs Mikey's approval. The rest of the data model, and the
conventions every record follows, are in [data-model.md](data-model.md).

## Recurring invoices

Decided 2026-11-22 while Mikey was away. Needs his approval.

`recurring_invoice`: a project, a description, an amount, every month,
quarter or year, an anchor day (later ones fall on it, or on a shorter
month's last day), the next day, an optional last day, whether each is sent
or left as a draft, days until due, and whether it is paused.
`invoice.recurring_id` says which made an invoice.

- HQ runs it each morning at 06:13 Eastern, and once when it starts. Each
  invoice and the move to the next day are one transaction, so no period is
  billed twice. Up to a year of missed periods are caught up.
- Started again after a pause, it picks up from its next day after today:
  the paused months are not billed.
- Events: `recurring-invoice.added`, `.paused`, `.resumed`, and the usual
  `invoice.created` and `invoice.sent`, by HQ (no actor).

## Touches

Decided 2026-11-22 at Mikey's request for a call log. Needs his approval.

`touch`: a client, optionally an opportunity and a contact, what it was
(call, email, text, meeting), for a call how it went (talked, voicemail, no
answer), a note, when, and who logged it. A conversation needs a note; a
missed call does not. Logged with `contact.edit`; setting the next
follow-up with it needs `opportunity.set-follow-up`. Event: `touch.logged`.

## Calls

Added by decision 0009, slice 1 (migration 0052). `call`: a call in
progress, at a client and optionally with a contact, on an opportunity or
for a booking; who's on it, the number dialed, when it started, the
planned minutes (5 to 240, in steps of 5; 30 by default, or the booking's
length; one tap sets 15, 30, 45 or 60), the warning minutes (5, or a third of a call under 15), notes
kept as they're typed, and when it ended and the touch it was logged as.
`touch` gains `minutes` and `call_id`.

- One open call per person (a unique index). Starting another answers with
  the open one.
- Only the person on the call sees or changes it. Starting, changing and
  ending need `contact.edit`; a follow-up set on ending needs
  `opportunity.set-follow-up`.
- Ending logs the touch and closes the call in one transaction. The length
  is whole minutes, rounded up.
- A call left open for 3 hours is ended every five minutes by the server,
  logged as 180 minutes with a note saying so.
- A booking from the public page counts as at its CRM client once it's
  been added to the CRM.
- Events: `call.started`, `call.length-changed`, `call.ended`,
  `call.ended-automatically`; `touch.logged` carries `minutes` and `callId`.

### Call guides and talking points

Added by decision 0009, slice 2 (migration 0053). `call_guide`: one guide
for each situation (first call, proposal follow-up, project check-in,
renewal, any call), with a title; `call_guide_question`: its questions in
order, up to 20. `call.guide` is the guide on the call. `call_answer`: for
a call, a guide and a question's place, the question as it was asked,
whether it was ticked, and what was said.

- A call starts with the guide that fits: no proposal or project yet is a
  first call; then a sent proposal, an active project, a renewal in 30
  days, in that order; otherwise any call. It can be switched; answers are
  kept per guide, so nothing is lost.
- Answers save as they're typed. `call.answered` is written the first time
  a question is ticked; `call.guide-changed` on a switch.
- Ending writes the notes, then a line for each question asked or
  answered, in every guide used, into the call log (up to 2,000 characters).
- Talking points are read, never stored, from projects, proposals,
  invoices, deliverables, change requests, call requests, messages, sites,
  renewals and touches. Each needs what its record needs: money
  `invoice.view`, a proposal `proposal.view` (its total
  `opportunity.view-value`), projects `project.view`, the rest `client.view`.
- Guides are read with `knowledge.view` and changed with `knowledge.edit`
  (`call-guide.changed`). A change applies to calls after it; a question
  already answered keeps its words.

### Following through from a call

Decision 0009, slice 3. No new tables.

- **Book another call**: the wrap-up panel offers the next six open times
  on Potomac's calendar, whether or not booking is open to clients or the
  public. Booking needs `call.respond`, the open call, and an email on the
  person's contact. It's a `booking` of kind `public` at the CRM client
  (`crm_client_id`, and `crm_opportunity_id` when the call is on one), with
  its own private link, so the person is emailed and can move it as usual.
  `booking.made` carries `from: "call"` and the `callId`.
- **Next steps**, one a line on ending (up to 10), each become a to-do for
  the person at the client and its opportunity, through the to-do service
  (`task.edit`).
- **The call's time** can go to one of the client's active projects,
  through the time service (`time.log`): billable when the project is
  billed by the hour, which is ticked to start with.
- These run after the call is logged, each in its own transaction; one
  that's refused is said in the message, and the rest still happen.

### Calls to make

Decision 0009, slice 4 (migration 0054). `call.return_to`: a path in HQ a
call goes back to when it ends (only `/…`, never `//` or `/\`).
`call_script`: the voicemail script, with `{name}`, `{me}` and `{about}`.

- Today's calls to make are read, never stored: calls asked for in the
  portal, follow-ups due (overdue first), invoices 7 or more days late, and
  opportunities going cold; one line per client with every reason, each
  only for those who may see it (`opportunity.view`, `invoice.view`). A
  client with a call logged today drops off, and is counted.
- A call started from the list goes back to it when it ends.
- Ending as voicemail or no answer, with no day chosen: on an open
  opportunity, its follow-up is set two business days on; at a client with
  no opportunity, a to-do "Call … again" is added for that day.
- The script is read with `knowledge.view` and changed with
  `knowledge.edit` (`call-script.changed`).

### Getting ready for a booked call

Decision 0009, slice 5. No new tables.

- A call booked with the person (its host) that starts within 15 minutes,
  or has started and not ended and hasn't been called, shows in the top
  bar and on Today with "Get ready". Not while they're on a call.
- `/get-ready/:booking` shows who, when, why they booked, the talking
  points (for a client in the CRM) and the guide HQ would start with, and
  starts the call. Needs `contact.edit`. A booking not in the CRM says to
  add it first.

### The recap email

Decision 0009, slice 6 (migration 0055). `call.recap_sent_at`: when the
call's recap went. Ending a call keeps the notes as typed on the call
(without the guide's answers, which stay in HQ).

- Ticking "Then write them a recap email" when ending a talk opens
  `/phone/:id/recap`: a draft to the contact on the call, from the notes.
  Only the person who made the call, after it's ended, to a contact with an
  email.
- Nothing is sent until "Send recap" is pressed. It goes once; a refused
  or failed send keeps the words. It's logged as an email in the call log
  ("Sent a recap of the call: …") with `call.recap-sent`.
- With email off, the draft is there to copy, with no Send button.

## Scheduling invites

Decided 2026-11-23 at Mikey's request. Needs his approval.

`schedule_invite`: a client, the client user it is for, a title, the call's
length, the first and last days (up to 14, from today on), a note, status
(open, confirmed, cancelled), when they answered, and the booking once
confirmed. `schedule_invite_cell`: each half hour they said they could do,
as a UTC instant. Only Potomac's free half hours are kept: painted free
(the day's own painting or its weekday's), not a day off, not busy in the
calendar, no call booked, not past.

Inviting, confirming and withdrawing need `booking.manage`; seeing invites
needs `call.respond`. The client answers in the portal, always through their
own organization; answering again replaces their answer. Confirming checks
the start is still free for both for the whole call, then books a client
call on the host's calendar. Events: `schedule-invite.sent`, `.answered`
(which notifies Potomac), `.confirmed`, `.cancelled`, and `booking.made`.

## Sign up to book

Decided 2026-11-23 at Mikey's request. Needs his approval.

No new tables. Signing up (`/portal/sign-up`, anyone, rate-limited, a field
only bots fill) makes, in the CRM, a prospective client named for the
business (or the person), its primary contact, and an opportunity "Signed up
to book a call" from the website, owned by whoever takes calls; then an
invited client user, with an emailed one-time link (`next=book`) to confirm
the email and choose a password. An email already in the CRM is left as it
is. An email that already has a portal user is sent a fresh invite or a
password link instead, and the page says the same either way.

Open only while "Anyone can sign up" (`booking_setting.public_open`) is on,
the hours are set, and email is set up. With it on, anyone with a portal
account can book there, even if portal booking for clients is off. The
account-free form at `/book` is gone; calls booked from it before keep
their private link. Events: `client-user.signed-up`,
`client-user.sign-up-again`, `opportunity.signed-up`.

## Availability grid

Decided 2026-11-23 at Mikey's request. Needs his approval.

The usual week is still `booking_hours`, now saved from a half-hour grid, so
a day can have many stretches (up to 24), and a stretch shorter than a call
is allowed (it has no open time). `booking_date` and `booking_date_hours`:
a day painted differently from its weekday, with its own stretches; listed
with none, it has no calls. A day painted the same as usual is removed.
Days off (`booking_closed_day`) still close a day whatever is painted.
Event: `booking.dates-painted`.

## Change requests

Decided 2026-11-22 at Mikey's request. Needs his approval.

`change_request`: a project, a number counted per project, a title, what it
covers, its price (zero for no charge), extra hours, and its status: draft,
sent, approved, declined or withdrawn. Who answered: a client user in the
portal, or an HQ user recording an answer given by phone or email. Drafted,
sent, withdrawn and recorded with `finance.edit`.

Approving, in one transaction: the project's budget, where it has one, grows
by the price and the hours (a project with no budget keeps none), and a
priced change gets a draft invoice of kind "other", "Change N: title", for
Potomac to check and send. Events: `change-request.drafted`, `.sent`,
`.withdrawn`, `.approved`, `.declined`, `project.budget-raised-by-change`,
`invoice.drafted-from-change`.

## Budget warnings

Decided 2026-11-22 at Mikey's request. Needs his approval.

Not stored: worked out from the budget, time, expenses and milestones. A
project is "watch" when 75% or more of its hours or money is used
(`WATCH_AT_PERCENT` in `src/finance/domain/budget.ts`) and the share of its
milestones done is lower than that. With no milestones, or on a monthly or
yearly plan, 75% used is enough. "Over" is unchanged.

## Project links

Decided 2026-11-22 at Mikey's request. Needs his approval.

`project_link`: a project, what it is (staging site, live site, designs,
documents, code repository, other), an optional name, a web address (http or
https only), and whether the client sees it in the portal. Added and removed
with `project.edit`. Events: `project.link-added`, `project.link-removed`.

## Going cold

Decided 2026-11-22 at Mikey's request. Needs his approval.

Not stored: worked out each time. An open opportunity is going cold when it
has no follow-up set and its last sign of life is 14 or more days ago
(`COLD_AFTER_DAYS` in `src/crm/domain/cold.ts`). Its last sign of life is the
latest touch with its client, about anything, or its own last change,
whichever is later. An overdue follow-up is not cold: Today already shows it
as overdue.

## To-dos

Decided 2026-11-22 at Mikey's request. Needs his approval.

`todo`: a title, an optional due day, whose it is, optionally a client and
one of its opportunities, when it was done, and who added it. It uses the
project task permissions: `task.view` to see and `task.edit` to add and tick
off, so a member can give one to anyone. Done ones are kept. Events:
`todo.added`, `todo.done`, `todo.reopened`.

Since decision 0007 (migration 0041) a to-do is a row in `task` with no
project: `task.project_id` is empty, and `task` gained `organization_id`,
`opportunity_id` and `created_by` for it. The `todo` table is gone; every
to-do kept its id. A task without a project has no phase, always has
someone, and is only `todo` or `done`. My work (`/todos`) lists to-dos and
project tasks together; the client and opportunity panels, Today and the
morning email list only to-dos, since Today shows project tasks as deadlines.
A to-do keeps its `todo.*` events. Ticking off a project task from My work
moves it as the board does (`task.moved`), so its timer stops.

## Task management

Labels, saved filters, quick add, subtasks, comments, repeats, notices and
reminders, the timeline and calendar feeds (decision 0007) have their own
page: [data-model-tasks.md](data-model-tasks.md).

## Morning email

Decided 2026-11-22 at Mikey's request. Needs his approval.

`user_preference.morning_email`: on (1) unless the person turns it off.
`morning_email_sent`: one row per person per day it went, claimed before
sending so a restart can't send twice. Sent at 07:03 business time, and on
start after 7 if it hasn't gone. Events: `user.morning-email-on`,
`user.morning-email-off`, `user.morning-email-sent`.

## Site monitoring

Decided 2026-11-22 while Mikey was away. Needs his approval.

`monitored_site`: a client, an address, its state (unknown, up, down),
failed checks in a row, when it went down, the last check and its result,
its certificate's expiry and the expiry already warned about.
`site_outage`: when each outage started and ended, and why.

- Checked every five minutes from `bin/serve.ts`, four at a time, with a
  ten-second limit. Under HTTP 400 is up.
- Down after two failed checks in a row; up after one good one. Each change
  is emailed once to `HQ_ALERT_EMAIL`, and the certificate two weeks before
  it runs out.
- **Only the public internet.** An address is refused if it is an IP, a
  local name, or a name that resolves to a private, loopback or link-local
  address, so a client's domain cannot be used to reach Railway's network.
- Seen with `client.view`, changed with `client.edit`. Events:
  `site.watched`, `site.unwatched`, `site.down`, `site.up` (by HQ).

## Site content

Decided 2026-11-23 at Mikey's request. See
`docs/decisions/0003-site-content.md` for the choices and what needs his
approval.

`content_site`: a client (one site each), a name, the repository, branch,
content file and photo folder, what is on the site (`published`, as JSON),
when and at which commit HQ last published, the content with the waiting
changes made (`draft`), its state (none, editing, submitted), who sent it
in and when, and Potomac's note when sending it back.
`content_photo`: a photo's bytes, its path in the repository, and whether
it is in the repository yet.

- A client's change makes or updates the draft and sets it to "editing".
  Sending it in sets "submitted". A further change by the client takes it
  back to "editing"; Potomac's own change leaves it as it is. A change that
  puts things back as they are on the site clears the draft.
- Publishing makes one commit through the `SitePublisher` port, then, in
  one transaction, makes the draft the published content, marks new photos
  as in the repository and deletes the bytes of removed ones. A change made
  while the commit was on its way stays waiting.
- One publish at a time for a site.
- A photo uploaded and then not used (removed again, or the changes
  discarded) is deleted.
- Setting up, changing, sending back and publishing need `site.publish`.
  The list is seen with `client.view`. A client user changes their own
  organization's site only.
- Events, all on record type `content-site`: `site-content.set-up`,
  `site-content.read-again`, `site-content.photo-added`,
  `site-content.photo-changed`, `site-content.photo-removed`,
  `site-content.photos-reordered`, `site-content.notice-changed`,
  `site-content.review-added`, `site-content.review-removed`,
  `site-content.changes-discarded`, `site-content.submitted`,
  `site-content.sent-back`, `site-content.published`. A client's carry
  `clientUserId`.
- Notices: `site-content.submitted` is emailed to admins and shows on the
  dashboard under what clients did. `site-content.published` and
  `site-content.sent-back` are emailed to the client when client notices
  are on.

## Site status

Decided 2026-11-23 at Mikey's request. See
`docs/decisions/0004-site-launch.md`.

On `content_site`: `launch_mode` (live, coming-soon, maintenance),
`opens_at` (the instant it opens by itself, or null), `launch_message`,
`site_url` (the site's own address) and `preview_key` (32 hex characters,
made the first time a site is closed).

- Changing the status is one commit of the content file as it is on the
  site, with a new `launch` block. A draft waiting to be checked is not in
  it. The record is saved after the commit succeeds.
- An opening time is a day and a time in the business time zone, stored as
  an instant. One already gone is refused.
- A site whose opening time has come is open, and HQ says so. Nothing is
  committed at that moment: the site switches by itself.
- The file holds the SHA-256 of the preview key, never the key. A new key
  is a commit while the site is closed.
- A client user sets the status of their own organization's site, and it
  takes effect at once. Potomac's people need `site.publish`, which also
  sets the site's address.
- Events: `site-content.status-changed` (with the mode and opening time),
  `site-content.preview-link-renewed`, `site-content.address-changed`. A
  client's status change is emailed to admins and shows on the dashboard.

## Service area

Decided 2026-11-23 at Mikey's request. See
`docs/decisions/0005-service-area.md`.

On `content_site`: `service_area` (migration 0037), the areas as JSON, as
last written to the site, or null for a site whose file has no service
area.

- Saving is one commit of the content file as it is on the site, with a new
  `serviceArea` block, like the status. A draft waiting to be checked is not
  in it. The record is saved after the commit succeeds. Changing the status,
  and publishing, write the service area back as it is.
- A county's outline comes from HQ's county file, never from the request.
- A client user sets their own organization's site's service area, and it
  takes effect at once. Potomac's people need `site.publish`.
- Event: `site-content.service-area-changed` (with the number of areas and
  of counties, and the commit). A client's change is emailed to admins and
  shows on the dashboard.
- A content file without a `gallery` is allowed when it holds a
  `serviceArea` or a `launch` block: the site has no photos, notice or
  reviews, and changes to them are refused (`no-gallery`).

## Referral links

Decided 2026-11-23 at Mikey's request ("a referral code for business cards
that scan a QR code, to a special link that tracks the success rate").
Needs his approval of the choices below.

`referral_link`: a code (the end of `/r/<code>`), a label saying what it is
printed on, and where a scan goes. `referral_scan`: one row a scan, holding
the link and the time. `referral_inquiry`: an opportunity credited to a
link, once.

- `/r/<code>` answers anyone. It counts the visit, then redirects to the
  destination with `?ref=<code>` added. The answer is never cached, so
  every scan reaches HQ.
- **A scan keeps a time and nothing else**: no address, no device, no
  cookie. So the count is of scans, not of people: someone who scans twice
  counts twice.
- Link previews, crawlers and HEAD requests are sent on and not counted.
  They are told apart by their User-Agent, which is a guess: a program that
  claims to be a phone is counted.
- The inquiry form takes a `ref` field. When it names a link, the new
  opportunity is credited to it. HQ's own `/contact` fills the field in
  from its address; a form on another site must do the same
  (`docs/operations.md`, "The inquiry form"). A `ref` that names no link is
  ignored. **Only inquiries are credited**: a call booked at `/book`, or a
  phone call, is not.
- The success rate is inquiries over scans.
- **QR codes are drawn by symbology** (`@journey-to-code/symbology`, pinned
  to an exact version), behind a `QrMaker` port with one adapter. Its Rust
  encoder ships as WebAssembly inside the package, so nothing is fetched.
  Two-factor setup still draws its code with HQ's own
  `src/shared/domain/qr.ts`; both are byte mode, level M, up to 213 bytes.
- A destination is an https address or one of HQ's own pages. A link's
  code never changes, because it is printed; its label and destination
  can. A link that has been scanned cannot be removed.
- **The printed code depends on HQ's address.** It holds
  `HQ_PUBLIC_URL/r/<code>`. If HQ moves to another address, the old one
  must keep redirecting, or the printed codes stop working.
- Made, changed and seen with `referral.manage` (admins and managers).
  Events: `referral-link.created`, `referral-link.edited`,
  `referral-link.removed`, `referral-link.inquiry` (by HQ). A scan writes no
  event: its row is the record.

## Renewals

Decided 2026-11-22 while Mikey was away. Needs his approval.

`renewal`: a client, what it is (domain, hosting, SSL certificate, email,
software license, other), a name, who it is bought from, the day it renews,
how often (1 month to 10 years), what it costs Potomac and what Potomac
bills (each optional), whether the provider renews it by itself, a note,
and whether it is still kept. Seen with `client.view`, changed with
`client.edit`. "Renewed" moves the date on one term from when it was due.
Events: `renewal.added`, `renewal.renewed`, `renewal.retired`.

Billing a renewal (decided 2026-11-23, `docs/decisions/0006-renewal-billing.md`,
migration 0038): `renewal.invoice_id` is the invoice last sent for it and
`renewal.billed_for` the renewal date that invoice was for, so a term is
billed once and "renewed" leaves the next one unbilled. The invoice is due a
week before it renews. Billing needs `client.edit` and `invoice.edit`, and
makes the invoice through finance (`RenewalBilling` port). Event:
`renewal.billed`, with the invoice, the date it renews, the due date and the
amount. The client's portal lists renewals billed to them two months ahead,
and while owed; never what they cost Potomac.

## Invoice reminders

Decided 2026-11-22 while Mikey was away. Needs his approval.

- `finance_setting.reminders_on`: off until someone with `finance.edit`
  turns it on.
- Steps: three days before the due day, the day after, a week late, two
  weeks late. Only the latest step that has come is sent, so an invoice
  found two weeks late gets one email, not four. After two weeks, a phone
  call: no more emails.
- To the client's primary contact with an email, or else its active portal
  users. `invoice_reminder` records each step sent, before sending, so none
  goes twice. `invoice_reminder_off` leaves one invoice out.
- Sent each morning at 09:07 Eastern, when email is set up. Events:
  `invoice.reminder-sent` (by HQ), `invoice-reminders.on`/`.off`,
  `invoice.reminders-stopped`/`.reminders-allowed`.

## Booking

Decided 2026-11-22 while Mikey was away, at his request for a booking
calendar. Needs his approval.

| Table | Holds |
| --- | --- |
| `booking_setting` | One row: the host (whose calendar calls go on: whoever last saved the hours), call length, gap after each call, notice, days ahead, and whether clients and the public can book |
| `booking_hours` | Up to two stretches per weekday, in minutes after midnight, Eastern time |
| `booking_closed_day` | Days with no calls, with an optional note |
| `booking` | Each call: client or public, booked or cancelled, start and end (UTC), name, email, phone, topic, the client's organization, and for the public a hash of its private link |

- Open times start at the beginning of each stretch, one call and one gap
  apart, at least the notice away, and clear of every booked call (and,
  later, of a connected calendar's busy times) by the gap.
- A time the clocks skip in spring has no call. Hours stay on the wall
  clock through clock changes.
- A booking is checked again inside the transaction that saves it, so two
  people cannot take the same time.
- A call from the public page can be added to the CRM once: it makes a
  client, a contact and an opportunity at "consult booked" from the
  website, through the CRM's own services, and remembers both ids
  (`crm_client_id`, `crm_opportunity_id`).
- Events: `booking.made`, `booking.cancelled`, `booking.moved`, `booking.added-to-crm`,
  `booking.hours-changed`, `booking.day-closed`, `booking.day-opened`.

## Linked calendars and filling in availability

Decided 2026-11-23 while Mikey was away. Needs his approval.

`calendar_link`: up to five calendars' private addresses (iCalendar, as
Google, Outlook and Apple publish them), with a name, who added it, when it
was last read and why it couldn't be. HQ reads each at most every five
minutes for busy times only, and never keeps or shows what an event is. If
one can't be read, its last answer is used for an hour; after that open
times are not offered, the same as when Google Calendar can't be read.

- The address is a secret: it is checked once when linked, never shown
  again, and never written to the activity log (only its name and site).
- Potomac can paint the next 14 days from a Timeful event (the times one
  person marked on it) or Calendly (the times it offers, by a personal
  access token). Days the source speaks for are painted in place of the
  usual week. Nothing about the source is kept.
- Someone answering an invite can fill it in from their calendar's address
  (every open half hour they aren't busy), a Timeful event or Calendly. It
  replaces their answer and counts as answering; nothing about the source is
  kept, and a Calendly token is used once.
- A half hour is free only when all of it is; busy when any of it is.
- Timeful has no published server API. HQ reads the same two addresses its
  event page does (`/api/events/<id>` and `.../responses`), only ever on
  `timeful.app`. If Timeful changes them, the fill says so and nothing
  else breaks. Events that hide answers or ask only about days can't be read.
- Addresses people type are read only over https, only on the public
  internet (never an address inside the server's network, checked on the
  connection itself), with at most three redirects, 2 MB and ten seconds.
  Ten reads an hour for each person.
- Events: `booking.calendar-linked`, `booking.calendar-unlinked`;
  `booking.dates-painted` and `schedule-invite.answered` carry `from`.

## Booking links

Decided 2026-11-23 while Mikey was away. Needs his approval.

Booking a free call needs a portal account (sign up at `/book`), unless
Potomac has given the person a booking link.

`booking_link`: who it is for, its token, whether it books one call or any
number, its last day (a week, a month, three months, or no end), how many
calls it has booked, and when it was withdrawn. `booking.link_id` and
`booking.business` record which link a call came from and the business the
person named.

- The link opens `/book/with/<token>`. It asks for a name, an email, a
  phone number and what the call is about (all required), and a business
  (optional), then the open times. Choosing one books it.
- A link works whether or not sign-up to book is open. It needs only hours.
- The token is kept as it is, so the link can be copied again from the
  Calls page. It lets its holder book a call and nothing else. It is never
  written to the activity log.
- A one-time link is spent by a booking, not by a try.
- After booking, the person lands on their call's own page (move, cancel,
  add to calendar). If sign-up is open they are offered an account there;
  it is never required and nothing is made for them.
- A call booked with a link is a "public" call: it shows on Calls as
  "Booking link" and is added to the CRM by hand, with the business filled
  in. Their own link moves or cancels it even when booking is closed.
- Ten bookings an hour from one address.
- Events: `booking-link.created`, `booking-link.withdrawn`; `booking.made`
  carries `linkId`.

## Importing clients, and demo clients

Decided 2026-11-23 while Mikey was away. Needs his approval.

`client_organization.demo`: a made-up business Potomac shows prospects (the
demo apps). Shown with a Demo badge on Clients, the client, Projects and the
project. Left out of: the dashboard's active projects and deadlines, Today,
the morning email, the pipeline report, the project health report, and
Money's budget against actual. Still everywhere else (the board, time, the
portal), so a demo can be shown working. Whoever may change a client's
status may mark it a demo or real (`client.demo-changed`).

Clients → Import takes a pasted CSV with a header line. Columns, in any
order: Client (needed), Contact, Title, Email, Phone, Website, Project,
Service, Pricing, Price, Source, Repository, Live, Demo. Up to 200 lines.

- Every line is checked first; one bad line saves nothing and names the
  line. All lines are saved in one transaction.
- A client already in HQ by name (any case) is skipped, so pasting the same
  list again is safe. Two lines with the same client are refused.
- A line with a Project becomes a won opportunity (moved through each
  stage, priced) converted to an active project, through the same steps and
  events as by hand, so the client becomes active. Without one the client
  stays a prospect. A project needs its pricing; a price unless free.
- Repository becomes a link for Potomac only; Live becomes a link shared
  in the client's portal.
- No key of its own: it takes every key adding the lines by hand would.
- Events: the usual ones for each record, `imported: true` on the client
  and opportunity, and one `client.imported` with the counts.

## Sign-in rules

`sign_in_rule`: one row per rule that is on, with who turned it on and
when. The only rule is `two-factor-for-admins`. Turning it on or off writes
`sign-in-rule.two-factor-required` or `sign-in-rule.two-factor-optional`.

## Passkeys

Decided 2026-11-23 while Mikey was away. Needs his approval.

A passkey (WebAuthn) is a second way to pass the second step at sign-in,
beside the code from an authenticator app. It never replaces the password.

| Table | What it holds |
| --- | --- |
| `passkey` | One per passkey: its owner, the credential id, the public key (JWK) and its algorithm (ES256, RS256 or EdDSA), the authenticator's counter, a name, and when it was added and last used |
| `passkey_challenge` | The challenge a session was last given, for one use within five minutes |
| `user_two_factor.app` | 0 when two-factor sign-in was turned on with a passkey alone |

- Two-factor sign-in can be turned on with a passkey and no app. The record
  is confirmed at once with a secret nobody was shown, and no 6-digit code is
  accepted. Recovery codes are made the same way and shown once.
- With an app set up, passkeys can be added beside it, up to ten. Adding an
  app to a passkey-only account is not built: turn two-factor off and on.
- The last way past the second step can't be removed; turning two-factor
  off removes every passkey, and so does an admin's reset.
- A passkey also proves it is you for new recovery codes and turning it off.
- Adding a passkey takes a fully signed-in session and no further proof.
- Passkeys are bound to the host the browser is on. When `HQ_PUBLIC_URL`
  is set, that is the only address they can be made or used at. Changing
  HQ's address means adding passkeys again; recovery codes get people in.
- Checked on every use: the challenge, the address the browser reports, the
  site hash, that someone was present, the signature, and that the counter
  went up (one that went back is refused as a copy). Only "none"
  attestation is asked for, so any authenticator is accepted.
- Events: `user.passkey-added`, `user.passkey-removed`; `user.two-factor-on`
  and `user.two-factor-passed` carry `with: "passkey"`. None carries a key,
  a credential id, a challenge or a signature.

## Refused attempts

Decided 2026-11-22 while Mikey was away. Needs his approval.

`refused_attempt`, apart from the activity log: the activity log is kept for
good and records what people did, and these can come from anyone on the
internet. Kept 90 days, left out of the export.

| Field | Rule |
| --- | --- |
| `kind` | `sign-in`, `second-step`, `portal-sign-in` or `permission` |
| `user_id` | The HQ user, for a wrong code or a refused form |
| `email` | The email typed at a sign-in. Never the password, never a code |
| `address` | Where the request came from |
| `detail` | Why, or for a form, which one, with ids left out: `POST /people/:id/roles` |

## The site builder

Decision 0010, slice 1 (migration 0056).

- `build`: a website being made for one client (`organization_id`), with
  its name and brief, who started it, and when it last changed.
- `build_version`: numbered from 1 per build. `files` holds every file of
  the version as one JSON object (path to text); `chars` is its size.
  `request_id` is the request that made it, or empty for one restored by
  `made_by`. Versions are never changed or removed.
- `build_request`: one request to Claude. `state` is `working`, `done` or
  `failed`. `reserved_micros` is its worst case, held under the cap while it
  works; `cost_micros` what it really cost, from the API's token counts, in
  millionths of a dollar. A failed request is still counted. `error` is a
  code, never the API's words.
- `builder_settings`: one row, the model and the monthly cap in cents.
- `build_image` (slice 2, migration 0059): a photo or the logo uploaded to a
  build, with its bytes, its type and size read from its own header, what
  it shows, and its path in the site (`images/logo-<12 hex>.png`), made
  from its id. Shared by every version of the build: the preview and the
  zip serve it beside the version's files. Removing one deletes it.

Events: `build.started`, `build.brief-changed`, `build.asked` (with what
was reserved), `build.version-made` and `build.request-failed` (by HQ
itself, with the cost), `build.restored`, `build.image-added`, `build.image-removed`,
`builder.settings-changed`. No
event carries the brief, the request's words or any file.

## AI assistance

Added by decision 0012 (migration 0058). The API key is never stored: it is
`HQ_ANTHROPIC_API_KEY` on the server.

| Table | Holds |
| --- | --- |
| `ai_setting` | One row: the model, its prices in millionths of a dollar per million tokens (with a dearer rate past `long_above` input tokens), the monthly budget in cents, the features turned on, the price guide, and who changed it last |
| `ai_usage` | Every call: the feature and record, the model, tokens in and out, the cost in millionths of a dollar, who asked (empty when HQ ran it by itself), whether a usable answer came, and the draft it made |
| `ai_draft` | What AI wrote, as the feature's JSON: `waiting`, `used` or `discarded`, the fingerprint of the records it came from, and a receipt's picture until the draft is decided |

- Events: `ai.settings-changed`, `ai.drafted`, `ai.failed`,
  `ai.draft-used`, `ai.draft-discarded`. Their context never holds the text
  AI wrote, only the feature, model, counts and cost.
- A recap draft is marked used when its recap is sent (`call.recap-sent`).
  A brief, an answer from Ask HQ and a site-down diagnosis are used where
  they're shown; a scope check that finds nothing out of scope is discarded
  by HQ, and kept so the message isn't checked twice.
