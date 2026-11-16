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
| Files sent by the client | A client's upload is a new way in for bad files | When a project needs it |
| Several organizations for one client user | One email, one organization | When someone needs it |

