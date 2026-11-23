# Using Potomac HQ

A guide for someone new to HQ. It follows the work in the order it happens.

## Getting in

You get an email, or a link from an admin. Open it and choose a password of
at least 10 characters. The link works once.

- **Forgot your password?** Use "Forgot your password?" on the sign-in page
  if email is set up. If not, ask an admin for a new link.
- **Settings**, top right, has the theme (light, dark, or follow your
  device), your password, two-factor sign-in, and the People list.
- **Two-factor sign-in.** Turn it on in Settings and HQ asks for a code from
  an authenticator app on your phone after your password. Keep the recovery
  codes it shows you somewhere safe: each signs you in once if you lose the
  phone. Used most of them? Settings makes ten new ones, with a code from
  the app, and the old ones stop working. With neither phone nor codes, an
  admin can reset it from the People page.
- **Passkeys.** Instead of an app, or beside one, use a passkey: your
  fingerprint, face or PIN on your phone or computer, or a security key.
  In Settings, choose "Turn on with a passkey", or "Add a passkey" once
  two-factor sign-in is on. After your password, choose "Continue with a
  passkey". Add one for each device you sign in from. A passkey can't be
  typed into a fake sign-in page, so it is the safer of the two.
- **Requiring it of admins.** On People, under Sign-in rules, an admin who
  has it on can require it of every admin. An admin without it can then
  open only Settings until it is on.

## What you can do depends on your role

| Role | In short |
| --- | --- |
| Member | Clients, opportunities, projects, tasks, notes, your own time, the knowledge base |
| Manager | All of that, plus prices, proposals, money, expenses, invoices, reports, inviting clients to the portal, and writing in the knowledge base |
| Admin | Everything, plus People and the audit history |

The full list is in the article "Authorization matrix".

## A lead comes in

1. **Clients**, then "Add a client". Add the person you talk to as a contact.
2. On the client, open an **opportunity**: what they want, and how they
   found Potomac.
3. Move it along the **Pipeline** as it goes: new, consult booked,
   consulted, quoted. Set a follow-up day and it shows on your dashboard
   when it is due.
4. Write what was said in **Notes** on the client or the opportunity.

## The proposal

1. On an opportunity that has been consulted, "Start a proposal". It begins
   from the template for that service.
2. Edit the sections and the estimate lines. Nothing is sent yet.
3. **Send** it. That freezes a numbered version, which never changes, and
   moves the opportunity to quoted. Download the PDF and send it yourself,
   or share it to the client's portal.
4. Record the answer. **Accepted** wins the opportunity, starts the project,
   sets its budget from the estimate, and drafts the deposit invoice, in one
   step. Check the draft and send it: it is on your dashboard.
5. Record the signed agreement against it.

## The project

- **Phases and milestones** are the plan. **Tasks** are the work.
- When a milestone is something the client has to do, like sending photos,
  tick "The client has to do this one". Their portal then puts it first,
  under "waiting on you".
- The **Board** shows tasks by status. Drag a card, or use its menu.
  Moving a task to "Working on" starts your timer. Moving it on stops the
  timer and logs the time.
- **Deliverables** are files for the client. A draft is yours. Share it and
  the client sees it in their portal and approves it or asks for changes.
- **Updates** on a project are what the client reads. **Notes** are
  internal and the client never sees them.
- Set the project's **health** honestly. It is what the dashboard and the
  reports show.

## Time and money

- **Time**: your week. Log hours against a project or task, or let the
  timer do it.
- A project's **Money** tab: hours and cost against the budget, expenses
  with receipts, invoices and payments.
- An **invoice** is drafted, then sent, which gives it its number. Record
  each payment against it. A mistake is voided, never deleted.
- HQ never takes a card number. A payment's reference is a check number or
  the card processor's reference.
- **Money**, in the top bar: every project at a glance, and the CSV exports.

## The client portal

On a client's page, "Invite someone to the portal". They get a link, choose
a password, and see only their own organization's projects, shared
deliverables, shared proposals and sent invoices. They can approve work,
accept a proposal by typing their name, send a message and ask for a call.
What a client does in the portal shows on your dashboard under "From your
clients", and the project's owner is emailed if email is set up.
Call requests show on your dashboard, with the number to call back on if
they gave one. They can also send files on a project: photos, a menu, a
price list. Those show on the project under "Files from the client". Open
one only if you were expecting it.

## Knowing what is going on

- **Calls.** Managers and admins set the hours for booked calls under
  Calls → Hours and days off. Everyone sees the calls booked, can add one to
  their calendar, and can cancel one with a reason the other side sees.
  With "Clients can book" on, clients choose a time in the portal, and can
  move or cancel their own calls. With "Anyone can book" on, the page at
  `/book` takes bookings from anyone: link to it from the website. A call
  from that page has "Add to the CRM", before or after the call: it makes
  the client, contact and opportunity in one step.
- **Recurring invoices.** On a project's Money page, set up hosting,
  maintenance or a retainer: an amount every month, three months or year.
  HQ makes each invoice in the morning on its day, as a draft or sent. The
  Money page shows what recurs a month and a year.
- **Invoice reminders.** Turn them on under Money, and clients are emailed
  about a sent invoice three days before it is due and when it is late, up
  to two weeks. An invoice's page shows what went, and can leave it out.
- **Sites.** On a client's page, add their website. HQ checks it every five
  minutes, shows it on the dashboard when it's down or its certificate is
  running out, and emails the alert address. Sites lists them all.
- **Renewals.** On a client's page, add their domain, hosting, certificate
  or licenses, with when each renews. Each shows on the dashboard 30 days
  ahead. Press "Renewed" when it is done, and its date moves on.
- **Today.** Start the day here. It's one list, in order: booked calls, what
  clients are waiting on, down sites, anything overdue, then today's
  follow-ups, to-dos and deadlines, and renewals this week. Work down it.
  For a follow-up, "Log a call" opens the opportunity where you log it and
  set the next one.
- **Going cold.** An open opportunity with no follow-up and no contact for
  two weeks shows on Today as going cold. Call them, or set a follow-up if
  you're waiting on them for a reason.
- **Finding a time together.** On a client's page, under Client portal,
  "Ask someone to pick times for a call". They mark every half hour they
  could do on a grid of your free time; you pick one that suits both and
  it's booked. Like a Timeful poll, inside HQ.
- **New people booking a call.** Turn on "Anyone can sign up at /book" on
  the Hours page (it needs email set up), and link your website to /book.
  People sign up, confirm their email, and book in their own portal. Each
  one shows up in the pipeline as "Signed up to book a call".
- **Booking links.** To let someone book without an account, make them a
  link: Calls → Booking links → say who it's for → Make a link, then copy
  the address and send it. They tell you who they are and what the call is
  about, and choose a time. Withdraw a link to stop it working.
- **Your availability.** Under Calls → Usual week, paint the half hours
  you're free for calls: press and drag across the grid. For one week that's
  different, Calls → Availability this week: paint over it. Busy times from
  your calendar and calls already booked show underneath.
- **Your calendars.** On the Hours page, under Your calendars, paste a
  calendar's private address (Google: Settings → your calendar → "Secret
  address in iCal format"). Its busy times are never offered for calls. Up
  to five. Already keep free times in Timeful or Calendly? On Availability,
  "Fill in from somewhere else" paints the next two weeks from them.
  Clients answering an invite get the same three ways to fill it in.
- **Change requests.** When a client asks for something that wasn't in the
  agreement, don't just do it. On the project's money page, draft a change
  with its price and hours and send it. They approve it in the portal (or
  tell you by phone, and you record it). Approving raises the budget and
  drafts the invoice.
- **Project links.** On a project, add where the work lives: the staging
  site, the designs, the code. Tick "Show it to the client" and it appears in
  their portal, so they always know where to look.
- **On your phone.** HQ works on a phone. From Today, tap "Log a call" on a
  follow-up; the opportunity page has the contact's number as a tap to call,
  and the call log right below it.
- **The morning email.** The same list arrives at 7 each morning, so the day
  starts with it. Turn it off in Settings if you'd rather not.
- **To-dos.** Anything you need to remember to do: "renew the business
  license", "send Rita the quote". Give it a day or leave it for whenever,
  give it to someone else, and add it from a client or an opportunity to tie
  it there. Tick it off when it's done.
- **Calls and messages.** On a client or an opportunity, log each call,
  email, text or meeting. For a call, say how it went. On an opportunity,
  set the next follow-up in the same step: "left a voicemail, try Thursday".
- **Inquiries.** The form at `/contact` (or on the website) puts each
  inquiry in the pipeline as a new opportunity from the website, and emails
  Potomac.
- **Profit and loss.** Money → Profit and loss by month: money received
  against money spent, a year at a time, with a CSV.
- **Search**, in the top bar: type a name, an email, a phone number, an
  invoice number or a few words from a task, and press Enter.

- **Waiting on you**, at the top of the Dashboard: what clients are waiting
  for. Clear it first each day.

- The **Dashboard**: follow-ups due, active projects, deadlines, hours this
  week, projects over budget, calls clients asked for, recent activity.
- **Reports**: the pipeline and win rate, project health and what is late,
  and budget against actual.
- **Knowledge**: how things are done here, and the decision log. Search it
  first. If the answer is not there, write it down once you know it.
- **Audit history** (admins): everything anyone did, with filters. Its
  **Refused attempts** page lists wrong passwords, wrong two-factor codes
  and forms someone tried without permission, for the last 30 days.

## Habits that keep HQ worth using

1. If a client said it, it goes in a note the same day.
2. An opportunity always has a next follow-up, or it is closed.
3. Time is logged the day it is worked.
4. A decision that someone might ask about later goes in the decision log,
   with the reason.
