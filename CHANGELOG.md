# Changelog

All notable changes to Potomac HQ are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

Every pull request into `staging` adds a line under Unreleased. A release
moves those lines under a version heading. See `docs/conventions.md`.

## [Unreleased]

- The newsletter, "Notes from the river" (decision 0010, slice 2). People
  sign up at `/river`, from a form on potomac.solutions, or through the
  website's server (`POST /api/site/newsletter` with its token), and are on
  the list once they press Confirm in the email they get. Each reader
  belongs to the river stop they signed up from (`src=stop:lakes`). Under
  Sales → Newsletter, write an issue, send yourself a test, and send it to
  everyone or some stops; it goes out 50 a minute, each reader once. Every
  issue carries Potomac's mailing address (needs `HQ_CONTACT_ADDRESS`), a
  one-click unsubscribe link and a `List-Unsubscribe` header. Leaving forgets
  the address. For managers and admins (`newsletter.manage`). Migration 0056.
- Decision 0010, growth tools: the newsletter, where leads come from, free
  landing pages, monthly reports to plan clients, n8n automations, reviews
  and case studies, referral credit, and who looked at a demo, in eight
  slices.

## [0.16.0] - 2026-11-25

- The recap email (decision 0009, slice 6). Ending a call where you talked
  can open a recap email to the contact, drafted from your notes. Read and
  change it, then "Send recap" or "Skip"; nothing goes until you press it,
  and it goes once. It's logged in the call log as an email. Migration 0055.
- Getting ready for a booked call (decision 0009, slice 5). Fifteen minutes
  before a call booked with you, the top bar and Today say "Call in 12
  minutes with …: get ready". Its page has why they booked, what's worth
  raising, the guide the call will start with, and "Start the call". Also
  on each upcoming call on the Calls page.
- Calls to make (decision 0009, slice 4). Today lists who to call, one line
  per client with every reason: calls asked for in the portal, follow-ups
  due, invoices a week or more late, and deals going cold. "Call" opens the
  call screen, and ending it goes back to the list, where that client has
  dropped off. The call screen shows a voicemail script, changed with the
  call guides. Ending as voicemail or no answer sets the follow-up two
  business days on, or adds a to-do to call again. Migration 0054.
- Following through from a call (decision 0009, slice 3). The wrap-up panel
  offers the next six open times; "Book it" books the next call while
  they're on the line, at the CRM client, and emails them as usual. Ending
  a call turns next steps, one a line, into to-dos, and can log the call's
  time to the client's project (ticked already, and billable, when it's
  billed by the hour).
- Call guides and talking points (decision 0009, slice 2). The call screen
  shows questions for the kind of call (a first call, a proposal follow-up, a
  project check-in, a renewal or any call), picked from what the client has
  and switchable. Tick each as it's asked and note what was said; it saves as
  you type, and the answers go in the call log with the notes. "Worth
  raising" lists what HQ's records say: what each side is waiting on, a
  proposal not answered, a late invoice, a site down or a certificate
  ending, a renewal coming and the last call's note, each only for those
  who may see it. Guides are changed under Knowledge → Call guides.
  Migration 0053.
- The call screen (decision 0009, slice 1). "Start a call" on a client, a
  contact, an opportunity or a booked call opens a screen with a big Dial
  button and a timer kept by the server. A call is planned for 30 minutes,
  or a booked call's length; one tap makes it 15, 45 or an hour, and −5 and
  +5 fine-tune it. Five minutes
  before the end (a third of a short call) the timer turns amber, the phone
  buzzes once with no sound, and a wrap-up list shows; at the end it turns
  red and counts the overtime. Notes save as they're typed, and the screen
  stays awake. "End call" logs it in the call log with its length. The top
  bar leads back to an open call, and a call nobody ended is closed after 3
  hours. Migration 0052.
- Decision 0009, call mode: start a call with a timer, a guide of questions
  with talking points from HQ's records, a warning to wrap up before the
  planned end, and the call logged with its length; then calls to make,
  getting ready for booked calls, and a recap email, in six slices.

## [0.15.1] - 2026-11-24

- Fixed: a form that's refused no longer loses what was typed. When the page
  comes back saying what was wrong, the form is filled in again as it was
  sent, so only the mistake needs fixing. Passwords, codes and files are
  never kept, and nothing is kept once a page has loaded.
- Fixed: hours can be typed as `.25` or `2.`, not only `0.25` and `2`. This
  goes for task estimates, time, budgets and change requests.

## [0.15.0] - 2026-11-24

- Import tasks from Trello and Todoist (decision 0007, slice 13). From a
  project's task list, upload a Trello board's JSON export or a Todoist
  project's CSV export, see what it would make, then import it all at once:
  statuses from lists and sections, labels, checklists and indented tasks
  as subtasks, due dates, and Todoist's priorities and repeats.

- Webhooks for n8n (decision 0007, slice 12). Admins add an https address
  (Company, then Webhooks) and pick what to send it: tasks added, assigned,
  moved, done or commented on, and projects added or completed. Each
  delivery is signed with a secret shown once, tried again for a day if it
  doesn't land, and the last 200 are listed with their answers.

- Sharing a project by link (decision 0007, slice 11). On a project, admins
  and managers make links for people without an account (`project.share`),
  to see the plan, tasks and shared deliverables, or also to comment on
  tasks under their own name. Links can have a last day and be stopped;
  each is shown once, and every visit is recorded. They never show notes,
  time, estimates, money or the team's own comments.

- A calendar feed (decision 0007, slice 10). Calendar feed (linked from My
  work and Settings) makes a private address for Google Calendar, Apple
  Calendar or Outlook: your open tasks with due dates and your projects'
  milestones, or one saved filter, as all-day events. It's shown once;
  making a new one stops the old. Read-only.

- The timeline (decision 0007, slice 9). Tasks can have a start date. Each
  project has a Timeline tab: the project from start to target, its phases,
  and its tasks and milestones as bars and points, with today marked and
  late work in red. Timeline in the sidebar shows every active project the
  same way. Drawn by the server, so it needs no script.

- Notices and reminders (decision 0007, slice 8). A bell in the header counts
  what's new for you: tasks and to-dos given to you, comments that
  @mention you, and reminders on a task, at a time or so many days before
  it's due, for you or for whoever has the task, and kept on each repeat if
  you like. They're listed on the Notices page and at the top of
  Today. Anyone can have theirs emailed once email is set up.

- Repeating tasks (decision 0007, slice 7). A task or to-do can repeat every
  so many days, weeks, months or years, counted from its due date or from
  the day it's done. Finishing it makes the next, with the same details,
  labels and subtasks, linked to the one before. Quick add understands
  "every week", "every 2 months", "every other week", "monthly" and the like.

- Comments and files on tasks (decision 0007, slice 6). Anyone who can see a
  task can comment on it, and mention people with @ and their first name.
  Only the author edits or deletes a comment; an edited one says so, and
  every version and deletion stays in the task's history. Files attach to a
  task with the same checks as deliverables, and can be removed from it.

- Subtasks and blocking (decision 0007, slice 5). A project task's page adds
  subtasks, each a task of its own in the same project, and shows "3 of 5
  done" there, on the task list and on the board. A task can wait on any
  other, in any project or a to-do; its page says what it waits on and what
  it holds up, and refuses circles. Moving a waiting task to "working on"
  goes ahead and says what it is still waiting on.

- Booking from the website. potomac.solutions can now show open times and
  book a call for someone new in one step: HQ makes their client account,
  books the call, and emails a link to their dashboard where they set a
  password and add or change their details. Anyone whose email or phone is
  already on file is not booked again; the sign-in link goes to the email on
  file instead. Both emails say to call or text Potomac if it wasn't them,
  and the website answers the same either way, so it never reveals who is a
  client. Emails match without "+tags", Gmail dots or case, and phones
  on their last ten digits. The portal's own sign-up follows the same rule.
  New `GET`/`POST /api/site/booking`, behind the website's token.
- Quick add (decision 0007, slice 4). A box in the top bar (or the N key)
  takes one line, like "Send the proof +better-days @sam !high *website
  fri", shows what it understood with a way to keep any part in the title,
  and adds it as a project task or a to-do. Dates, labels (new ones made),
  people, priority and a project or client are read from the words.

- The work table (decision 0007, slice 3). All work (`/work`, under
  Delivery) lists every task and to-do you may see, filtered by project,
  client, person ("me", "nobody"), label, status, priority, when it's due
  and words in the title, and sorted by any column either way. Each person
  chooses their columns. A filter can be saved, shared with everyone and
  pinned to your sidebar, and the table downloads as CSV.

- One inbox (decision 0007, slice 2). A to-do is now a task without a
  project: migration 0041 moves every to-do into the task table, keeping its
  id. To-dos become My work (`/todos`, in the sidebar under Today): your
  to-dos and project tasks together by when they're due, with each one's
  project and labels. Ticking off a project task there stops its timer, as
  the board does. Every to-do has its own page, where it takes labels, and
  can only be to do or done.

- Labels on tasks (decision 0007, slice 1). Twelve colours, each readable
  in light and dark. Put them on from a task's page, making a new one on the
  way; they show on the task list and the boards. A Labels page lists them
  with how many tasks have each, and admins and managers rename, recolour
  and delete them there (`label.manage`).
- Decision 0007, task management after Vikunja: labels, one inbox for
  tasks and to-dos, filters and a table, quick add, subtasks and blocking,
  comments and attachments, repeats, reminders, a timeline, a calendar
  feed, sharing a project by link, webhooks, and import from Trello and
  Todoist, in thirteen slices.

## [0.14.0] - 2026-11-24

- Dependabot: `@hono/node-server` 2.1.9 to 2.1.11, and `dependency-cruiser`
  18.7.2 to 18.8.0. (Its TypeScript 7 bump was undone; see below.)

- Our website. A new admin-only page, Company → Our website, controls
  potomac.solutions itself: open it, put up a "coming soon" or
  "maintenance" page with your own heading, message and time note, and put
  an announcement on top of every page. A private preview link lets admins
  see the real site while it is closed. Unlike clients' static sites (Site
  content), potomac.solutions runs its own server: it asks HQ for these
  settings every half minute, answers a closed visit with a 503, and keeps
  the last settings if HQ is down. Connect it with `npm run site:token` on
  the HQ server, then give the website service that token as `HQ_SITE_TOKEN`
  and HQ's address as `HQ_URL`. New permissions `public-site.view` and
  `public-site.edit`, for admins only. Migration 0039.

- Billing a client for a renewal. On a client's page under Renewals, "Bill
  the client" makes and sends an invoice for a renewal's coming term, due a
  week before it renews, so there's time to renew it or let it lapse. Each
  renewal says whether it is billed, paid, or wasn't paid in time. The
  client sees it in their portal under "Coming up for renewal", with the day
  to pay by, two months ahead and while it is owed. Paying by card in the
  portal waits on the card gateway being chosen
  (`docs/decisions/0006-renewal-billing.md`). Migration 0038.

- Service areas. A business that goes out to customers can show where it
  goes on its website, and change it in the portal under "Where you go":
  pick whole counties on a map (or tick them in a list), or draw an area
  point by point and name it. It takes effect as soon as it is saved, by the
  client or by Potomac, as one commit of the site's content file; changes
  waiting to be checked stay waiting. County outlines are HQ's own, for
  Maryland, West Virginia, Virginia, Pennsylvania, Delaware and DC. A site
  with no photo gallery can now be set up, for a site that has only a
  service area or a status. Needs the site's code to draw the
  `serviceArea` block (`docs/decisions/0005-service-area.md`). Migration 0037.
- Zubra packages upgraded from 6.0.3 to 6.0.5. All four move together and
  stay pinned to the exact version. Nothing in HQ needed to change: the type
  check, the Zubra regression suite and every integration test pass as
  before.

- TypeScript is back on 6.0.3. Dependabot's move to 7.0.2 left the boundary
  check (dependency-cruiser) reading no files, so `lint:boundaries` passed
  while checking nothing and its self-test failed. Dependabot now skips
  TypeScript's major versions until dependency-cruiser supports 7.

- Open, coming soon, or closed for maintenance. On a site's page in HQ and
  in the client's portal, "Is the website open?" chooses what visitors see
  and, if wanted, the day and time the site opens by itself. It takes
  effect as soon as it is saved, by Potomac or by the client, as one commit
  of the site's status. While a site is closed, a preview link shows the
  real site to whoever holds it; a new link can be made if it gets passed
  on. Needs the site's code to read the `launch` block of its content file
  (`docs/decisions/0004-site-launch.md`). Migration 0036.

- Clients change their own website. On a client's page, under Website
  editing, say where their site's code lives on GitHub; HQ reads its
  gallery, notice and reviews. In the portal, under "Your website", the
  client adds, removes and reorders photos, changes their words, posts a
  notice and adds reviews, then sends the changes in. Nothing reaches the
  site until someone with the new `site.publish` permission (admins and
  managers) publishes it under Delivery → Site content, or sends it back
  with a note. Publishing is one commit to the site's repository; the site
  rebuilds from it. Photos are shrunk in the browser before upload. Needs
  `HQ_GITHUB_TOKEN` (`docs/operations.md`, "Site content"). The choices
  are in `docs/decisions/0003-site-content.md`. Migration 0035.

- Referral links. Under Sales → Referral links, make a short address for
  each thing you print (business cards, a flyer), choose where a scan goes,
  and download its QR code. HQ counts every scan, sends the person on, and
  credits the inquiries that follow, so each link shows its success rate.
  A scan keeps a time and nothing about the person. Link previews and
  crawlers are not counted. For managers and admins (`referral.manage`).
  The inquiry form takes a `ref` field: add it to the website's form
  (`docs/operations.md`). QR codes are drawn by
  `@journey-to-code/symbology` 0.2.0, a new dependency. Migration 0034.

## [0.13.0] - 2026-11-23

- Fixed: "Open HQ in your app", while turning on two-factor sign-in on a
  phone, was left off the page, because pages only link to web addresses.
  It now goes through HQ, which sends the phone on to the app.
- Fixed: an address starting with two slashes, as scanners send looking for
  files like .env, answered with an error and filled the error log. It is
  now refused as a bad request. Nothing was ever read or shown.

- Import clients, and demo clients. Clients → Import takes a pasted CSV
  (from a spreadsheet or typed): each line becomes a client, its contact
  and, if it names a project, a won project with links to its code and live
  site. Every line is checked first, one mistake saves nothing and says
  which line, and clients already in HQ are skipped. A client can be a
  demo: a made-up business you show prospects. Demos carry a Demo badge and
  are kept out of the dashboard's figures, Today, deadlines, the reports and
  Money. Clients can be filtered to real or demo. Migration 0033.

- Booking links. Booking a free call needs a portal account, unless you
  give someone a link. On Calls, make a link for a person (one call or any
  number; a week, a month, three months, or no end) and copy it. With it
  they give their name, business, email, phone number and what the call is
  about, choose a time, and are booked with no account. Afterwards they are
  offered a free account, and need not take one. The call shows on Calls as
  "Booking link" with the business and the reason, ready to add to the CRM.
  Migration 0032.

- Fill in availability from somewhere else. On Calls → Hours, link up to
  five calendars by their private address (Google, Outlook, Apple): their
  busy times are never offered for calls and show on the week's grid. On
  Calls → Availability, paint the next two weeks from a Timeful event or
  from Calendly. A client answering an invite can fill it in from their
  calendar's address, a Timeful event or Calendly instead of marking by
  hand. Repeating events, time zones and moved occurrences are understood.
  Addresses are read only on the public internet; a calendar's address and
  a Calendly token are never logged, and a client's are never kept.
  Migration 0031.

## [0.12.0] - 2026-11-23

- Passkeys for two-factor sign-in. In Settings, turn two-factor sign-in on
  with a passkey (your fingerprint, face or PIN, or a security key) instead
  of an authenticator app, or add passkeys beside the app. After the
  password, HQ asks for the passkey; a recovery code still works when it is
  lost. A passkey also proves it is you for new recovery codes and turning
  two-factor off. HQ checks each use itself, with no new dependency, and
  refuses a passkey from another address, a replayed answer and a copied
  key. Migration 0030.

- The page pass. The dashboard opens with a row of figures (clients
  waiting, due follow-ups, open opportunities, active projects, budgets at
  risk, your hours), each a link, then two columns: what needs someone
  beside what is coming. A client, an opportunity and a project each have a
  header with their status, a rail of facts on the left and the work on the
  right. The pipeline's stages are lanes. Follow-up dates read "Sat, Nov 21,
  2 days ago" on the pipeline and the opportunity. The sign-in page is a
  proper front door.
- Zubra UI in the pages: every status label is a status badge (green, amber
  and red for project health), breadcrumbs are the breadcrumb trail and end
  with the page you are on, figures are stat cards, and the simple dropdowns
  are select fields.

- A new look and frame for HQ. A sidebar groups every section (Today and
  Dashboard; Sales; Delivery; Finance; Company), so Calls, Board, Sites,
  Renewals, People and Audit history are one click away instead of hidden
  behind other pages. A top bar holds a wider search and your account. Pages
  use the full width of the screen. The typeface is IBM Plex Sans, served by
  HQ itself. Cards and inputs are white on a pale page, in light and dark.
  On a phone the sidebar folds behind a Menu button.
- Zubra UI is updated to commit 0f852ba, with ten more components copied in
  for the pages to use: status badge, breadcrumb trail, stat card, avatar,
  progress bar, code input, select field, check box, date field and step
  indicator. The top nav bar component is no longer used.

- Scheduling invites, like a Timeful poll: from a client's page, ask
  someone in their portal to pick times for a call (what it's for, how long,
  up to two weeks of days, a note). They're emailed a link, and it's first on
  their portal's "waiting on you" list. On a grid of your free time over those
  days they tap or drag every half hour they could do. You see your free time
  and theirs, and every start free for both for the call's length; pick one
  and it's booked as their call, with emails to both. Withdraw an invite any
  time. Open invites are listed on Calls. Migration 0029.

- Sign up to book: booking a call now needs a free account. /book explains
  the three steps and sends people to sign up (name, business, email,
  phone) or sign in. HQ emails a link to confirm the address and choose a
  password, then they choose a time in the portal and can move or cancel it
  there. Signing up makes them a prospect in the CRM, with their contact and
  a "Signed up to book a call" opportunity in the pipeline. Nothing on the
  page says whether an email was already known; someone with an account is
  emailed a link to sign in instead. Needs email set up, and "Anyone can
  sign up at /book" on Hours. Calls booked from the old form keep their
  private link.

- The availability grid: paint when you're free for calls, half hour by half
  hour, like Timeful. Press and drag to paint a rectangle (drag from a
  painted cell to rub out); on a phone, tap; with a keyboard, Space. Your
  usual week is painted on Hours; any one week can be painted differently on
  the new Availability page (a holiday, an early finish, an extra evening),
  with busy times from your calendar and calls already booked shown
  underneath. Open times for booking follow the painted days. Migration 0028.

## [0.11.0] - 2026-11-22

- Fixed: on a phone, a table that scrolls sideways can now be scrolled from
  the keyboard (it takes focus), which the phone pass in 0.11.0 missed.
- Change requests: for work beyond what was agreed. On a project's money
  page, draft one with what it is, its price (or no charge) and its extra
  hours, and send it. The client sees it in the portal, on their "waiting on
  you" list and in their email notice, and approves or declines it, saying
  why if they like; or record an answer they gave by phone. Approving raises
  the project's budget by the change's price and hours and drafts its
  invoice, in one step. Potomac hears about the answer like any other client
  action. Migration 0027.
- Early budget warnings: a project that has used three quarters of its hours
  or money while less of its milestones are done is marked "Watch", before
  it goes over. The dashboard panel is now "Budgets to watch" (over first,
  then watch, each saying how much is used and how many milestones are
  done), Money tags it, and the project's money page says it is time to talk
  to the client about scope.
- Project links: on each project, where its work lives: the staging and live
  sites, the designs, documents, the code. Shared ones show in the client's
  portal under "Where to see the work"; the rest, like the repository, stay
  with Potomac. Addresses typed without https:// get it. Migration 0026.
- Operations: why no Railway deploy stayed up. HQ stopped at start because
  test's database path was relative and `RAILWAY_RUN_UID` was not set, and
  production had no volume or variables. Then the domain answered 502
  because HQ listened on Railway's port 8080, not 3000. The guide now lists the Railway
  settings that work and how to check that a deploy is healthy.
- Search fits a phone: long results wrap and the box shrinks. The phone
  check now runs at 320px, the narrowest common phone.
- On a phone: every staff page now fits a 360px screen. Wide tables scroll
  inside their panel instead of widening the page, long names and email
  addresses wrap, and a client's contacts stack instead of squeezing into
  columns. Phone numbers on clients and opportunities are a tap to call.
  An opportunity shows its contact (the client's primary contact when none
  was chosen) with phone and email, and its call log and to-dos come right
  after "Where it stands", so logging a call is near the top.
- Going cold: an open opportunity with no follow-up set and no contact with
  its client for 14 days shows on Today, quietest first, with a button to log
  a call, and is flagged on its own page. Any call, email, text or meeting
  with the client, or a change to the opportunity, warms it; so does setting
  a follow-up.
- The morning email: at 7 each morning, everyone gets their Today list by
  email, numbered in order with a link to each thing. A day with nothing due
  sends nothing, and it goes once a day even if HQ restarts. Turn it off in
  Settings. Needs email set up. Migration 0025.
- Today: one list of what wants doing today, in the order to work it. Calls
  booked for today first, then what clients are waiting on, sites that are
  down, anything overdue, then today's follow-ups, to-dos and project
  deadlines, and renewals in the next week. Tick off to-dos in place, add one
  for today, and see what you've done. Today is in the top bar; To-dos is
  reached from it.
- To-dos: add one for yourself or anyone, due on a day or whenever, about a
  client or one of its opportunities. A To-dos page lists yours (or
  everyone's) as overdue, today, coming up and whenever, with what you ticked
  off this week. Clients and opportunities show their open to-dos and add
  them in place. Migration 0024.
- Calls and messages: log a call (talked, left a voicemail, no answer), an
  email, a text or a meeting on a client or an opportunity, with who it was
  with and a word about it. On an opportunity, the next follow-up is set in
  the same step. Each client and opportunity shows its timeline and when it
  was last touched. Migration 0023.
- Profit and loss, under Money: each month of a year, what was invoiced,
  received and spent, and received less spent, with the year's totals and
  what the money went on. Earlier years too, and a CSV of every month,
  which the finance sheet copy also gets. A management view on a cash
  basis, not the books.

- An inquiry form at /contact, and for a form on Potomac's website (sites
  listed in HQ_FORM_ORIGINS may post to it and be sent back). Each inquiry
  becomes a new opportunity from the website, at a new client with its
  contact, or at the client of someone already in the CRM, and is emailed
  to HQ_INQUIRY_EMAIL (or the contact or alert address). Limited by address
  and email, with a field that turns bots away.

- Site monitoring: add a client's website on their page, and HQ checks it
  every five minutes. Two failed checks in a row mean it's down: the
  dashboard says so and the alert address gets one email, and another when
  it's back. Certificates are flagged two weeks before they run out. Sites
  lists every one with its uptime over 30 days and recent outages. Only
  public addresses are checked. Migration 0022.

- Renewals: each client's domains, hosting, SSL certificates, email and
  licenses, with who they're bought from, when they renew and how often,
  what they cost and what is billed, and whether they renew by themselves.
  Overdue and next-30-days ones are on the dashboard; Renewals lists all
  with a year's cost and billing. "Renewed" moves a date on a term.
  Migration 0021.

- Invoice reminders emailed to clients, off until turned on under Money:
  three days before a sent invoice is due, the day after, a week late and
  two weeks late, then no more. Each goes once, to the client's primary
  contact or else their portal users, with what is owed and how to pay. An
  invoice can be left out on its own page, which lists what was sent.
  Migration 0020.

- Recurring invoices, for hosting, maintenance or a retainer: on a
  project's Money page, an amount every month, three months or year, from a
  first day, until a last day or until paused. Each morning HQ makes the
  invoices whose day has come, as drafts or sent, naming their period
  ("Hosting, January 2027"), and catches up on missed days once each. Money
  shows what recurs in a month and a year. Migration 0019.

- Someone who booked from the public page goes into the CRM in one step,
  from Calls: a client named for their business, them as its contact, and
  an opportunity from the website at "Consult booked", with what they wrote
  as its summary. The call then links to it. Migration 0018.

- Booked calls can avoid busy times in a Google Calendar, once
  `HQ_GOOGLE_CALENDAR_ID` and a service account are set and the calendar is
  shared with it as "See only free/busy". HQ asks only whether a time is
  busy. If Google can't be reached, no times are offered rather than wrong
  ones.

- Emails about booked calls, once email is set up. The person who booked
  hears about each change: booked, moved, cancelled. Someone from the
  booking page gets their private link to keep. The host hears about the
  changes they did not make. A reminder goes the day before, once, for calls
  booked at least 20 hours ahead. A failed email never undoes a booking.
  Migration 0017.

- A public booking page at /book, for anyone, such as a prospect from the
  website, once it is switched on under Calls → Hours. They give a name,
  email, an optional phone and what it is about, and choose a time. Their
  call's own page, at a private link, adds it to a calendar, moves it or
  cancels it. Five bookings an hour from one address, three a day for one
  email, and a hidden field turns bots away.

- Clients book calls in the portal, once it is switched on under Calls →
  Hours: they choose an open time, say what it is about, and can move or
  cancel it and add it to their calendar. "Ask for a call" stays, for when
  no time suits. HQ sees each call with the client's name and email.

- Booking, first part: the hours Potomac takes calls (up to two stretches a
  weekday, call length, a gap after each call, notice, how far ahead), days
  off, and a Calls page with every booked call, its calendar file, and a way
  to cancel it. The next calls are on the dashboard. Clients and the public
  can book in the next releases. Migration 0016, permission `booking.manage`.

- New recovery codes from Settings, without turning two-factor sign-in off
  and on: it takes a code from the app, shows ten new codes once, and the
  old ones stop working.
- Rate limits on both sign-ins, the two-factor step and "Forgot your
  password?" are kept in the database, so restarting HQ no longer resets
  them. Keys are stored only as hashes. Migration 0015.
- Two-factor sign-in can be required of every admin, under People →
  Sign-in rules. It ships off. An admin without it can then open only
  Settings until it is on, and no admin can turn theirs off while it is
  required. Members and managers are not affected. Migration 0014.
- Refused attempts are written down: wrong passwords at HQ and portal
  sign-in, wrong two-factor codes, and forms someone signed in was not
  allowed to use. Admins see the last 30 days on Audit history → Refused
  attempts. Kept 90 days, apart from the activity log, and never with the
  password or code typed. Migration 0013.

- An admin without two-factor sign-in is reminded at the top of the
  dashboard, with a link to turn it on. It stays optional.
- Two-factor setup shows a QR code to scan with the authenticator app. It
  is served only to its owner while they turn it on, and never kept. The
  link the app reads is shorter: it leaves out settings every app assumes.
- Fixed: a withdrawn invite's link still made a sign-in account, which
  opened nothing in HQ but kept that email from being invited again.
  Withdrawing an invite now spends its link.
- Dependabot watches npm packages weekly, and GitHub Actions and the Node
  image monthly, and opens pull requests into staging. Security alerts are
  turned on in the repository's settings (docs/operations.md).
- Two-factor sign-in for HQ accounts, with an authenticator app. Turn it on
  in Settings: add HQ to the app by its link or key, enter a code, and get
  ten recovery codes, shown once. After that, HQ asks for a code after the
  password, and nothing in HQ opens until it is given. A code works once,
  the second step allows five tries a minute, and only hashes of recovery
  codes are kept. An admin can reset it on the People page for someone who
  lost their phone. Migration 0012.
- Search from the top bar, and a search page. One box finds clients,
  contacts (by name, email or phone), opportunities, projects, tasks (by
  title or description), proposals, invoices (by number, written any way:
  "INV-0003", "inv 3", "#3") and knowledge base articles. Every word typed
  must match. The best matches come first, up to eight of each kind. Each
  kind is searched only for someone who may see it.

## [0.10.0] - 2026-11-22

- Zubra packages upgraded from 5.19.0 to 6.0.3. All four move together and
  stay pinned to the exact version. Nothing in HQ needed to change: the type
  check, the Zubra regression suite, every integration test and every
  browser test with its accessibility checks pass as before.

- The dashboard opens with what clients are waiting on: a message nobody has
  answered, changes asked for on a deliverable, a call to return, a drafted
  invoice to send, and an invoice past its due day. Each line goes to the
  place to deal with it, and shows only to someone who may. It replaces the
  separate calls panel.
- Accepting a proposal drafts its deposit invoice, one third of a fixed
  price, for Potomac to check and send. Nothing reaches the client until it
  is sent. Hourly, monthly and yearly work gets none, and neither does a
  project that already has a deposit invoice.
- Time worked reads as hours and minutes ("2 h 31 min"), not as a decimal
  that looks like a clock time. Forms still take hours like "1.5".
- Days in HQ read "Fri, Nov 20, in 4 days" on the dashboard, projects,
  tasks, the board and reports.
- The top bar fits at a laptop's width: the board moved under Projects (it
  is linked from the Projects page and the dashboard), and the signed-in
  name gives way to the links where the bar is tight.
- Empty dashboard panels are one line instead of a box.
- Between a phone's width and about 1,120px the top bar's links take a
  second row instead of running off the edge. A browser test checks the bar
  at nine widths. The copied Zubra nav bar folds its links only below 640px;
  `docs/upstream/zubra-ui-nav-bar-fold.md` is the report to file.

## [0.9.0] - 2026-11-16

### Security

- Zubra packages upgraded from 5.17.0 to 5.19.0. 5.17.0 and 5.18.0 let some
  requests past a guard: a path starting `//`, a page whose pattern was
  spelled differently from its layout's, a `Host` header with a path in it,
  and a `redirect()` to another site.

### Added

- M0 discovery documents: workflow, tool boundaries, stack decision 0001,
  first-slice data model and authorization matrix.
- Repository scaffold: `src/<module>/<layer>` structure for the `shared`,
  `identity` and `crm` modules, with one public entry file per module.
- Boundary lint (dependency-cruiser) that fails when `domain` or `application`
  imports Zubra, a UI framework or another module's internals, with a
  self-test that proves each rule fires.
- Test runners: `node:test` for domain, unit and integration tests, Playwright
  for end-to-end tests.
- CI on GitHub Actions, including a job that runs domain tests with no
  packages installed.
- Release automation: a changelog gate on pull requests and an automatic
  GitHub release when `staging` is merged into `main`.
- Scope for v0.1 and v0.2, cut to the smallest version that supports the
  first slice (`docs/scope-v0.1-v0.2.md`).
- Shared domain types: `Id`, `Money` (whole minor units plus a currency) and
  a `Result` type for answers given as codes.
- Migration runner: numbered, forward-only SQL migrations with checksums,
  each applied in its own transaction, and an `npm run migrate` command.
- Database helper that opens SQLite with foreign keys on and wraps work in a
  transaction.
- Activity events: the append-only `activity_event` table (migration 0001),
  with triggers that reject every update, delete and replace.
- Audit helper `recordActivity`, which every use case calls inside the same
  transaction as its change. It refuses context that names a secret.
- Users, roles and permissions (migration 0002), with the three roles seeded
  to match `docs/authorization-matrix.md`.
- `can()` and `authorize()`, the permission check every application service
  runs first. It denies by default and reads roles from storage each time.
- `createFirstAdmin`, which works only while HQ has no users.
- A test that fails if the authorization matrix document and the code differ.
- Sign-in through the Potomac kit's `staff` module: a one-time setup link for
  the first admin, sign-in, sign-out and change password, with accounts and
  sessions stored in SQLite (migration 0003).
- A rate limit on sign-in and link routes, a 16 KB limit on posted forms, and
  security headers on every response.
- An activity event for every sign-in, sign-out, password change and reset
  link.
- `npm start` and `npm run reset-link`, and `.env.example`.
- An end-to-end test of the sign-in workflow in a real browser.
- The application shell (`src/app.zb`), served by `@zubra/router`: a skip
  link, the top bar with the Potomac mark, navigation and account actions,
  and a 404 and 500 page inside the shell.
- The Potomac theme for Zubra UI: the website's neutrals with the mark's blue
  as the primary colour, every colour defined as a light and dark pair, and
  a test that checks each pair against WCAG AA contrast.
- Five Zubra UI components copied in at a pinned commit, with a check that
  fails if a copy is edited.
- The dashboard with its first panel, recent activity, read from the audit
  table. Admins see everything. Managers and members see activity on client
  records only.
- Sign-in, no-access and dashboard pages as Zubra components. Pages work with
  JavaScript turned off.
- A boundary check for `.zb` files, and automated accessibility checks (axe,
  WCAG 2.1 A and AA) on every screen in the browser tests.
- A workaround for a Zubra router bug found here and reported upstream
  (journey-to-code-org/zubra#300): the shell imports no component that a
  page also uses, because one imported by both was rendered twice.
- Deploy configuration for Railway: a Dockerfile, `railway.json` with a
  health check and one replica, and a deploy workflow that ships `staging` to
  the test environment and `main` to production after CI passes. It is the
  last job in CI, and it skips until the Railway tokens and service name are
  set.
- Nightly encrypted backups at 3:17 a.m. business time, to Cloudflare R2 or
  a local folder. The server seals each backup with a public key and cannot
  open it; only the private key can. Each backup, and each failure, is an
  activity event.
- `npm run backup`, `npm run backup:keygen` and `npm run restore`. Restore
  writes a new file, never over an existing one, and runs SQLite's integrity
  check.
- v0.2's first slice, without pages yet: client organizations, contacts,
  opportunities and project stubs (migration 0004), their rules, and their
  services. Each service checks permission and writes an activity event in
  the same transaction. A won opportunity makes its client active and can be
  converted once into a project; monthly and yearly plans become ongoing
  projects. Deal prices are left out of everything a member is given.
- Amounts are read as people type them (`$1,250.00`) and shown the same way.
- Pages for the first slice: the clients list, a client's page with its
  contacts and opportunities, an opportunity's page with its stage, price,
  follow-up and conversion, and a project's page. Every form posts to the
  server and works with JavaScript turned off.
- The dashboard's second panel: follow-ups due, with overdue ones marked.
- Form posts are refused unless the browser says they came from HQ itself,
  are plain forms, and are under 16 KB.
- The pipeline (`/pipeline`): open opportunities grouped by stage, each
  with a button that moves it to the next stage and comes back.
- A status filter on the clients list, and an "Open opportunities" panel on
  the dashboard with a count for each stage.
- Outbound email through Brevo, and "Forgot your password?": a one-time
  link by email, answered the same whether or not the email has an account,
  sent only to active users, and rate limited per address and per email. It
  is off until the Brevo key and a sending address are set, and the sign-in
  page shows the link only when it is on.

- v0.3 Projects. A project now has an owner, a health, start and target
  dates and a description, with phases, milestones and tasks under it. The
  next milestone is always worked out from the plan. Built while Mikey was
  away: the open decisions it settled are in `docs/scope-v0.3-v1.0.md`.
- The projects list (`/projects`), a project's task list and board, a board
  across every active project (`/board`) with "only mine", and a page for
  each task. Cards are dragged between columns. Each card also has a small
  form that does the same, so the board works from the keyboard and with
  JavaScript turned off.
- Drag and drop on the pipeline, beside the existing buttons.
- A file service: uploads are limited to 25 MB and a fixed list of types,
  each checked against the file's first bytes. Every download is authorized
  on the server and sent as an attachment, and uploads and downloads are
  activity events. Files are kept in the database, so the nightly backup
  holds them (decision 0002).
- Deliverables on a project: a title, a file, and a switch that shares it
  with the client.
- Notes on clients, opportunities and projects. A note is written once.
- A project's history, read from the audit table.
- Dashboard panels for active projects and for milestones and tasks due in
  the next two weeks.
- Dark mode (issue #2). Each person chooses light, dark or their device's
  setting on a new Settings page. It needs no script.
- Eight permissions for the above, held by every role.

- v0.4 Proposals. A proposal is started from an opportunity, filled from a
  template for its service, and edited as a working copy: four sections and
  a table of estimate lines with a total, the hours and, for a fixed quote,
  the deposit of one third.
- Sending makes a numbered version that can never change (database triggers
  refuse it), prices the opportunity and moves it to quoted. Editing after
  that makes the next version, and the old ones stay readable.
- Each version has a page laid out for reading and printing, and a PDF that
  HQ writes itself, with no package added.
- Recording the client's answer notes who, when, how and to which version.
  Accepting wins the opportunity, starts its project and sets the project's
  baseline from the accepted estimate, as one change.
- A signed agreement is recorded against an accepted proposal: where the
  paper is kept, or a scan of it.
- Four proposal permissions, held by admins and managers. A member is sent
  no proposal and no baseline.

- v0.5 Time and budgets. The timer starts by itself when a task is moved to
  "working on" and stops when it is moved on, logging the time. Time can
  also be typed in on a new Time page, which shows a week at a time.
- Expenses on a project, each with a category, an amount, a day and an
  optional receipt kept by the file service.
- A Money tab on each project: hours and cost against the budget, hours by
  phase, margin as an operational estimate, payment status and the
  invoice's reference. The budget is the accepted proposal's until one is
  set by hand. A monthly or yearly plan is measured over its current
  period.
- A Money page across every project, with CSV exports of time, expenses and
  budget against actual, invoices and payments. Each export is recorded.
  Text a spreadsheet would run as a formula is defused.
- Invoices, as the tool boundaries ask: numbered in order with no gaps,
  drafted with lines, sent, voided, and downloaded as a PDF. Payments are
  recorded against a sent invoice by cash, check or a gateway's reference,
  and a reference that looks like a card number is refused. A project's
  payment status follows its invoices by itself.
- Finance records can be copied to a Google Sheet each night
  (`HQ_SHEETS_SPREADSHEET_ID`, `HQ_SHEETS_SERVICE_ACCOUNT`), into tabs of
  HQ's own that never touch anything else in the sheet. Off until both are
  set. Not yet run against a real sheet.
- Dashboard panels for hours this week and projects over budget.
- Nine permissions. Everyone logs their own time. Costs, budgets, expenses,
  invoices, payments and exports are for admins and managers.

- v0.6 Client portal, at `/portal`. A client user is separate from an HQ
  user, belongs to one client organization, and holds no HQ permission.
  They are invited from the client's page and get in by a link that works
  once: emailed when email is set up, shown once to the inviter when it is
  not.
- In the portal a client sees their projects with milestones, downloads
  shared deliverables and approves them or asks for changes, reads a shared
  proposal and accepts or declines it by typing their name, downloads sent
  invoices, reads updates and writes back, and asks for a call.
- On HQ's side: a portal panel on each client, updates on each project, and
  call requests on the dashboard. Four permissions. Inviting a client and
  switching their access is for admins and managers.
- An isolation suite that runs on every merge. It signs in as one client
  and tries every portal page, download and form against another client's
  records, and every HQ page and form with a client's session.

- v1.0 Platform. A People page where an admin invites someone with roles,
  withdraws an invite, changes roles, turns an account off or on and makes
  a new password link. HQ always keeps one admin who can sign in.
- A knowledge base with categories, tags, search and every revision kept,
  and a decision log inside it. It is filled from HQ's own documents when
  HQ starts.
- An audit history page for admins: every activity event, filtered by
  person, kind of record, action and day, with a CSV of the same filter.
- A Reports page for admins and managers: the pipeline and win rate,
  project health and what is late, and budget against actual.
- `npm run restore:drill` opens a backup, checks it, starts HQ on the copy
  and deletes it. `npm run export` writes every record and stored file to a
  folder. `npm run retention` applies the retention policy, which also runs
  each night.
- Errors are logged as JSON lines and, with `HQ_ALERT_EMAIL` set, emailed,
  at most once in fifteen minutes for the same error. The health check now
  tests the database and answers 503 when it cannot be read.
- `npm run test:zubra`, a regression suite for what HQ relies on Zubra to
  do. It runs in CI.
- Documents: an operations runbook with the first-deploy checklist, a user
  guide, a retention policy, and security and accessibility self-reviews
  that say what they did not cover.
- Three permissions: everyone reads the knowledge base, and admins and
  managers write in it and see reports.
- The client portal, reworked after a pass as four clients (a farmer, a
  movie theater owner, a body shop owner and a restaurant owner). It now
  fits a phone, with one column and buttons big enough to hit. The home
  page starts with what is waiting on the client. Days read "Sat, Nov 21,
  in 5 days". A project's steps are a checklist. A proposal says what it
  costs first and what happens after an answer. Invoices say what is owed
  in all and how to pay.
- Clients can send files on their own active projects: photos, a menu, a
  price list. Each is checked like every upload and is theirs alone. A
  project takes at most 20 a day. Potomac sees them on the project.
- A message can be sent from the portal's home page, the newest updates
  show there, and a call request takes a number to call back on.
- `HQ_CONTACT_PHONE`, `HQ_CONTACT_EMAIL` and `HQ_CONTACT_ADDRESS`: how
  clients reach Potomac, shown at the foot of every portal page.
- A milestone can be marked as the client's to do. Their portal lists it
  first, as "Your turn", with a button to send a file.
- A deliverable that is a picture is shown on the portal page.
- The dashboard has "From your clients": what clients did in the portal in
  the last two weeks. With email set up, the project's owner is emailed.
- With `HQ_CLIENT_NOTICES=on`, a client is emailed that something is
  waiting. The email says what kind of thing and never what it holds, and
  each client user can turn theirs off. Off by default.
- The container's start script handles Railway's root-owned volume: started
  as root it hands the database's folder to the unprivileged user and drops
  to it. `docs/operations.md` says to set `RAILWAY_RUN_UID=0`.

### Changed

- HQ's own sign-in uses the cheaper password hash in tests only. Nothing
  changes in production.
- The top bar shows only what the signed-in person may open: Proposals and
  Money are not offered to a member.

- The top bar's "Change password" link is now "Settings", which links on to
  the change password page.
- Shared test setup lives in `test/support/`, and the services are wired in
  one place (`src/services.ts`) for the app and the tests alike.

- Boundary lint: any module's domain may now import `src/shared/domain`.
  `shared/domain` still imports nothing.
- Boundary lint: a module may expose its infrastructure through
  `src/<module>/adapters.ts`, which only infrastructure code may import.
- Zubra packages upgraded from 5.15.0 to 5.17.0, and `@zubra/router` 5.17.0
  added. Nothing uses the router yet.
- Pages now send `Cache-Control: private, no-store`, from `@zubra/router`
  5.19.0. It was `no-store`.
- The content security policy now allows scripts and stylesheets from HQ's
  own origin only. Nothing inline runs.
- Boundary lint: UI code may import the design system in `src/shared/ui`.
- The signed-out home page answers 401 with the sign-in form, where it
  answered 200.
- Outbound email will go through Brevo, wired in v0.2. Recorded in the stack
  decision, tool boundaries and scope.
- CI also runs on pushes to `main`, so the deploy can wait for it.
