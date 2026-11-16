# Scope for v0.3 to v1.0

Status: decided 2026-11-16 while Mikey was away. Needs his approval.

On November 16 Mikey asked for the rest of the roadmap to be built without
stopping, until HQ is ready to deploy to Railway. The conventions say a
decision the roadmap and `docs/` do not cover is asked, not guessed. He was
not there to ask. So each open decision was settled with the smallest option
that meets the roadmap's line, and is written down here. Any of them can be
reversed. Nothing below has been used with real records yet, and the "week of
real use" between releases has not happened: the gates in the roadmap are
still open.

## v0.3 Projects

### Kept

| Roadmap line | Smallest version built |
| --- | --- |
| Project record | Owner, status, health (set by hand), start and target dates, a description |
| Phases and milestones | Phases in order. Milestones with an optional due date and phase. The next milestone is worked out, never stored |
| Tasks | Assignee, priority, due date, estimate in hours, four statuses. No dependencies |
| List view and board | A list per project, a board per project, and one board across every active project with "only mine". Drag and drop, with a form on each card that does the same without a mouse or JavaScript |
| Project history | Read from the audit table |
| Deliverables and the file service | Upload, type and size checks, authorized downloads, both recorded. Sharing with the client is a switch that v0.6 reads |
| Dashboard panels | Active projects, and deadlines in the next two weeks |

### Moved in from v0.2

- **Notes** on clients, opportunities and projects.
- **Drag and drop on the pipeline.** The buttons stay.
- **Dark mode** (issue #2): light, dark, or the device's setting, chosen per
  person in Settings.

### Decided here

- **Files are kept in the database** (decision 0002).
- **Every role holds the eight new permissions.** A member already does all
  client work except deal values.
- **A project's health is set by hand.** Working it out from overdue
  milestones would be a rule nobody has asked for.
- **Notes cannot be edited or deleted.**

### Cut

| Cut | Why | Lands |
| --- | --- | --- |
| Reordering phases and editing or deleting milestones and phases | Adding and completing is what the slice needs | When a real project needs it |
| Task comments | The project's notes hold the conversation | When a second person joins |
| Notes on contacts | A contact has no page of its own. A note on the client covers it | If contacts get pages |
| Search and sort on the lists | Still under a screenful | When a list passes a screenful |

## v0.4 Proposals

### Kept

| Roadmap line | Smallest version built |
| --- | --- |
| Proposal linked to an opportunity, with sections | Scope, deliverables, assumptions and exclusions as four text fields. A line starting with a dash is a list item |
| Estimate lines and a pricing summary | Item, hours or quantity, rate, total. A table of inputs that works without JavaScript: empty rows are dropped, and saving adds more |
| Templates | One per launch service, in code, with the list prices from the workflow document |
| Status flow and immutable versions | Draft, sent, revised, accepted, declined. Each send is a numbered version that database triggers stop from changing |
| Preview and PDF | A page laid out for reading and printing, and a PDF written by HQ itself |
| Acceptance and Agreement | Who, when, how and which version. An Agreement says where the signed copy is, with a scan if there is one |
| Accepting creates the project and its baseline | One transaction: opportunity won, client active, project started, baseline set |

### Decided here

- **The PDF is written by a small writer in HQ** (`src/shared/infrastructure/pdf.ts`),
  in the standard Helvetica faces every reader has. No package was added. It
  does headings, paragraphs, lists and tables, which is all a proposal needs.
- **A sent proposal is the quote.** Sending prices the opportunity and moves
  it to `quoted`. Until now the price was typed on the opportunity by hand.
  That form still works for deals with no proposal.
- **Proposals are for admins and managers.** A member never sees a deal's
  value, and a proposal is nothing else.
- **Templates are in code, not editable in HQ.** The roadmap asks for
  reusable templates. Eight fixed ones meet that for one person.
- **Agreements are kept in HQ**, as a note of where the paper is or a scan.
  M0 decided contract signing is built in, not bought: the typed acceptance
  in the portal is v0.6.

### Cut

| Cut | Why | Lands |
| --- | --- | --- |
| Editing templates in HQ | Eight fixed ones are enough to start | When the wording has settled from real proposals |
| Emailing the proposal from HQ | The PDF is downloaded and sent by hand, as the workflow says | With the portal, where the client reads it |
| A "valid until" date | Not asked for | If quotes start going stale |

## v0.5 Time, expenses and budgets

### Kept

| Roadmap line | Smallest version built |
| --- | --- |
| Time entries with a quick-entry form | One form on the Time page: a project or one of its tasks, a day, hours, a note. A week at a time, yours or everyone's |
| The timer (M0 decision) | Starts when a task is moved to "working on" and stops when it is moved on. One per person |
| Expenses with a receipt | Category, amount, day, note, and a receipt kept by the file service |
| Budget per project, seeded from the accepted proposal | The baseline is the budget until one is set by hand |
| Estimated against actual, per project and per phase | Hours and cost for the project. Hours for each phase |
| Payment status | Not invoiced, deposit paid, invoiced, paid. It follows the project's invoices by itself, and can be set by hand |
| Invoices (from `docs/tool-boundaries.md`, not the roadmap) | Numbered invoices with lines, sent and voided, a PDF, and payments received by cash, check or a gateway's reference |
| Revenue and margin summary | On the Money page, labelled an operational estimate |
| CSV export | Time, expenses, budget against actual by project, invoices, and payments |
| Dashboard panels | Hours this week, and projects over budget |

### Decided here

- **An hour of work is counted at $75**, the consulting rate, until a
  project's own rate is set. This is what "cost" means for one person's time.
- **"Deposit paid" is a payment status.** The roadmap lists three. The
  workflow says work starts only after the deposit, so that step needs to be
  seen.
- **A recurring plan is measured over its current month or year.**
- **Removed entries and expenses stay in the table**, marked removed.
- **The Google Sheet copy is built** (`docs/tool-boundaries.md`: a one-way
  sync from HQ to the sheet). Which sheet and its layout were an open item
  "needed before v0.5". Without an answer, HQ writes five tabs of its own,
  each named with "HQ" in front, and replaces only those, so nothing Mikey
  keeps in the sheet is touched. It is off until its two settings exist. It
  follows Google's published API and is tested against a stand-in. It has
  not been run against a real sheet.
- **Invoices are in.** The roadmap leaves invoicing to an outside tool, but
  the approved tool boundaries build it into HQ at v0.5, and that document
  is the later decision.
- **A payment's reference is refused if it looks like a card number**, to
  keep rule 1 of the tool boundaries: HQ never sees one.
- **Expenses are for admins and managers.** A member logs time only.

### Cut

| Cut | Why | Lands |
| --- | --- | --- |
| Editing a time entry | Remove it and log it again | When it gets tedious |
| Invoices worked out from logged hours | An invoice's lines are typed, with amounts suggested from the budget | When hourly work is common enough to need it |
| Emailing an invoice from HQ | The PDF is downloaded and sent by hand | With the portal |
| Per-person hourly rates | One person works here | When a second person joins |

## v0.6 Client portal

### Kept

| Roadmap line | Smallest version built |
| --- | --- |
| Client users, separate from HQ users | A `client_user` belongs to one client organization, has no role and no permission, and signs in at `/portal` |
| Invite and sign-in | A link that works once. Emailed when email is set up, and shown once to the inviter when it is not |
| Project status and milestones | Their projects with status, health, milestones and the next one due |
| Deliverables with approve or request changes | The shared ones only, with the file. Asking for changes needs a reason |
| Proposals, with acceptance | Only a proposal Potomac turned sharing on for. Accepted or declined by typing a name |
| Invoices | A list of sent invoices with what is left to pay, and the PDF |
| Messages | One list of updates per project. Potomac posts, the client writes back |
| Booking (from `docs/tool-boundaries.md`, not the roadmap) | The client asks for a call in their own words. Potomac confirms a time or declines |
| The isolation suite | `test/integration/portal-isolation.test.ts`, run on every merge |

### Decided here

- **The portal's accounts use the kit's `staff` module a second time**, with
  its own collections and its own cookie. Writing a second password and
  session system by hand was the other choice, and the kit's is already
  tested. An HQ account and a portal account are different things even with
  the same email address.
- **The portal lives in the same app, under `/portal`.** No second host and
  no second deploy.
- **A client cannot reset their own password.** They ask Potomac, who makes
  them a new link. A self-serve reset needs email working, and it is one
  more public form to defend.
- **Typing a name is recorded as the client's answer**, with the name, the
  day, the version and "in the client portal". **Whether a typed name is
  enough for the agreement in West Virginia needs a lawyer's answer.** Until
  then the signed agreement of v0.4 is still how the paper is kept.
- **Sharing a proposal to the portal is switched on per proposal**, and is
  off to start.
- **A client is told about nothing by email.** They see updates when they
  sign in. Potomac sees a client's message on the project and a call
  request on the dashboard.
- **Members may post updates and answer call requests.** Inviting a client
  and switching access is for admins and managers.

### Cut

| Cut | Why | Lands |
| --- | --- | --- |
| The payment page | The card gateway is not chosen (`docs/tool-boundaries.md`, open item 1), and HQ must never see a card number. An invoice shows what is owed and says how to pay | When the gateway is chosen |
| A calendar for booking | A request and an answer do the job for one person's calendar | When requests are frequent |
| Self-serve password reset and password change | See above | With email in real use |
| Email notices to clients | Needs wording Mikey approves, and unsubscribe handling | After the portal's first real client |
| ~~Files sent by the client~~ | Built after all. See "The portal, as a client" below | Done |
| Several organizations for one client user | One email, one organization | When someone needs it |

## v1.0 Platform

### Kept

| Roadmap line | Smallest version built |
| --- | --- |
| Admin screens for users and roles | A People page: invite with roles, withdraw an invite, change roles, turn an account off or on, make a new password link |
| Knowledge base | Articles with a category, tags, search and every revision kept. Filled from the `docs/` folder when HQ starts |
| Decision log | A decision is an article with the day it was made. The log is the knowledge base filtered to decisions |
| Audit history with filters | Every activity event, by person, kind of record, action and day, 50 to a page, with a CSV of the same filter |
| Reports | Pipeline, project health, and budget against actual, on one page |
| Restore drill | `npm run restore:drill`: opens a backup, checks it, starts HQ on it, and deletes the copy |
| Full data export | `npm run export`: one JSON file per table and every stored file |
| Retention policy, enforced | `docs/retention-policy.md`, and a nightly run that removes expired sessions, links and unused invites |
| Monitoring, error logging, alert | Errors as JSON lines in the log, an email per error at most every fifteen minutes, and a health check that tests the database |
| Security and accessibility reviews | `docs/reviews/`, both self-reviews, both saying what they did not cover |
| Zubra regression suite | `npm run test:zubra`, which also runs in CI |
| User documentation | `docs/user-guide.md` and `docs/operations.md`, both also in the knowledge base |

### Decided here

- **The reviews are self-reviews.** The roadmap asks for a security review
  and an accessibility review. The same hand wrote the code and the
  reviews, so each one says plainly that it is not independent and lists
  what a person still needs to check. **These two gates are not met.**
- **No drill has been run on a real backup.** The command is tested against
  a backup of a test database. The gate asks for a real one, and that needs
  the R2 bucket and the private key, which only Mikey has.
- **Articles are plain text shown as text.** No HTML is passed through, so
  an article can never carry a script. Bold and links are not drawn.
- **HQ's documents go into the knowledge base once and are not kept in
  step.** The repository stays their source.
- **The export and the drill are commands, not buttons.** Each one hands
  over every record HQ holds. Whoever can run a command on the server
  already has the database, so nobody gains anything they did not have.
- **The audit log is never thinned.** It is small, and it is the record.
- **Finance records are never removed by HQ** until an accountant says how
  long they must be kept.
- **Alerts go by email only**, through the same Brevo account. If Brevo is
  down, the error is still in the log.
- **Reports are for admins and managers**, like the money they show.
- **The first release is numbered 0.9.0, not 1.0.0.** Everything in the
  roadmap through v1.0 is built, but v1.0's gates are open: no real restore
  drill, no independent review, and nobody has used HQ for real work. 1.0.0
  is kept for when they close. Mikey can change the number before he merges
  the release.

### Cut

| Cut | Why | Lands |
| --- | --- | --- |
| Two-factor sign-in | Not in the roadmap. Listed as a gap in the security review | Before a second admin |
| Rich text in articles | Plain text is safe and enough to start | When it gets in the way |
| Custom roles and per-person permissions | Three fixed roles cover one to a few people | When they do not |
| Charts in reports | Tables say the same with less to maintain | When someone asks |
| A status page inside HQ | The log and the alert email say more | When there is someone besides Mikey to look |
| Removing a client's records on request | Needs a decision about what must be kept | When it is first asked |
| An uptime monitor | HQ cannot watch itself from outside. `docs/operations.md` says to point one at `/healthz` | Mikey sets one up |

## The portal, as a client

Decided 2026-11-16, at Mikey's request: walk the portal as four clients and
fix what gets in their way. Needs his approval like the rest.

Each client is one a small-town business would be. The portal was opened on
a phone as each of them, and every change below answers something that
client could not do, or could not find.

### A farmer, on a phone in the field

| What got in the way | What changed |
| --- | --- |
| The home page was wider than the phone, with tables squeezed into it | One column. Every table in the portal is now rows that stack. A test fails if a page is wider than a 360 pixel phone |
| Days read `2026-11-21` | "Sat, Nov 21, in 5 days", and "was due Sat, Nov 14, 2 days ago" when late |
| No way to just call | Potomac's phone number and email are at the foot of every portal page, the sign-in page too |
| Buttons were small | Every button in the portal is at least 44 pixels tall. A test checks it |
| "Milestone", "Active, On track", "Billable hours so far 0" | "Steps", "On track", and no hours line until there are hours |

### A movie theater owner, who works nights and weekends

| What got in the way | What changed |
| --- | --- |
| Nothing said what was waiting on them. A design to approve was two pages in | The first panel on the home page is "waiting on you": each deliverable to look at, proposal to answer and invoice to pay, with one button to the place to do it. It says so when nothing is |
| Steps were a table of dates | A checklist: done steps ticked with the day they were done, the rest with their day and how far off it is, and a bar for how far along |
| The call form suggested office hours | It asks in their words, with examples like "after dark" and "Monday when we're closed" |
| They could not tell if their manager had access | The home page lists who can sign in for their business, and says to ask Potomac to change it |

### A body shop owner, who wants the price first

| What got in the way | What changed |
| --- | --- |
| A proposal's price was at the bottom, under the scope | "What it costs" is the first panel: the total, what is due to start, and what is due before launch, with a button to the answer |
| Nothing said what accepting would set off | "What happens next" under the answer: an invoice for the deposit, work starts when it is paid, and declining owes nothing |
| "Pay by cash or check" did not say where to send one | The total owed, and "How to pay" with who to make the check out to and where to mail it |
| Potomac had no number to call back on | The call form takes one. Potomac sees it on the dashboard and the client's page |

### A restaurant owner, between lunch and dinner

| What got in the way | What changed |
| --- | --- |
| No way to send the menu or photos | "Send us a file" on each project. See the decision below |
| Writing to Potomac meant finding the project first | A message box on the home page |
| Potomac's latest update was inside the project | The three newest updates are on the home page |
| Asking for a change was one line | A text box with room to write |

### Decided here

- **Clients can send files.** v0.6 cut this as "a new way in for bad
  files". All four clients needed it, and the farmer's first step was
  "photos and prices from you". The risk is held by the same checks every
  upload gets: the type is read from the file's contents and has to match
  its name, the size is capped at 25 MB, the file is only ever served as a
  download, never shown or run, and it belongs to the client's own
  organization. On top of that: one project takes at most 20 files a day
  from the portal, a finished project takes none, and Potomac's page says
  to open one only if it was expected. **HQ does not scan files for
  viruses.**
- **Potomac's phone, email and mailing address are three settings**
  (`HQ_CONTACT_PHONE`, `HQ_CONTACT_EMAIL`, `HQ_CONTACT_ADDRESS`). Each part
  is left off the page when its setting is empty.
- **"On track" is still what Potomac set.** A project can say "On track"
  while a step is late. The portal shows both and does not decide for
  Potomac which is true.

### Still in the way

| What | Why it was left |
| --- | --- |
| A client is not told when something is waiting. They have to sign in to see it | Email to clients was cut at v0.6: it needs wording Mikey approves |
| A design opens as a download, not on the page | Showing a client's or Potomac's file in the page is the risk the file service exists to avoid. A PDF opens in the phone's own viewer |
| Paying by card | The gateway is not chosen |
| A phone photo in HEIC format is refused | Most phones send a JPG to a web form. If one does not, the message says to save it again |
| Nothing says which steps are the client's to do | Milestones have no owner. A step named "Photos from you" is the workaround |

