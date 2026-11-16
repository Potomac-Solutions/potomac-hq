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
