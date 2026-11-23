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

## Renewals

Decided 2026-11-22 while Mikey was away. Needs his approval.

`renewal`: a client, what it is (domain, hosting, SSL certificate, email,
software license, other), a name, who it is bought from, the day it renews,
how often (1 month to 10 years), what it costs Potomac and what Potomac
bills (each optional), whether the provider renews it by itself, a note,
and whether it is still kept. Seen with `client.view`, changed with
`client.edit`. "Renewed" moves the date on one term from when it was due.
Events: `renewal.added`, `renewal.renewed`, `renewal.retired`.

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

## Sign-in rules

`sign_in_rule`: one row per rule that is on, with who turned it on and
when. The only rule is `two-factor-for-admins`. Turning it on or off writes
`sign-in-rule.two-factor-required` or `sign-in-rule.two-factor-optional`.

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
