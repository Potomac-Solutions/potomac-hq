# Authorization matrix

Status: approved 2026-11-14.

This lists every action in HQ and which role may take it. Each row
is one permission key. Each application service checks its key with
`can(user, action, record)` before doing anything.

## Roles

| Role | Who | In short |
| --- | --- | --- |
| `admin` | Mikey | Everything |
| `manager` | A future manager | Everything a member can do, plus deal values and reassigning owners. No user management, no full audit history |
| `member` | A future employee or contractor | All client work except deal values. No user management, no full audit history |
| Client user | A client signing in to the portal | Nothing until v0.6 |

The roadmap starts with `admin` and `member`. `manager` was added during M0
so that someone can see deal values without being an administrator.

## Rules

1. **Deny by default.** An action not listed here is refused for everyone.
2. **Checked on the server**, in the application service. Hiding a button in
   the UI is for convenience and is never the check.
3. **Every permission has a test** showing that a user without it is refused.
4. **A disabled user can do nothing**, whatever roles they hold.
5. **Roles are read from the stored user**, not from what a session claims.
6. **No record-level limits in the first slice.** A member who may view
   clients may view all of them. Record-level checks arrive with the client
   portal.

## Matrix

### Identity and users (v0.1)

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| Sign in and sign out | none | Yes | Yes | Yes | No (v0.6) |
| Change own password | none | Yes | Yes | Yes | No (v0.6) |
| Ask for a password reset link by email | none | Yes | Yes | Yes | No (v0.6) |
| View the list of users | `user.view` | Yes | Yes | Yes | No |
| Invite a user | `user.invite` | Yes | No | No | No |
| Disable or re-enable a user | `user.set-status` | Yes | No | No | No |
| Change a user's roles, or require two-factor sign-in of admins | `user.set-roles` | Yes | No | No | No |
| Send a user a password reset link, or reset their two-factor sign-in | `user.reset` | Yes | No | No | No |
| Turn own two-factor sign-in on or off | none | Yes | Yes | Yes | No |
| Add or remove own passkeys | none | Yes | Yes | Yes | No |
| Turn own morning email on or off | none | Yes | Yes | Yes | No |

### Dashboard and audit (v0.1)

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| View the dashboard | `dashboard.view` | Yes | Yes | Yes | No |
| View recent activity on client records | `activity.view` | Yes | Yes | Yes | No |
| View the full audit history, including sign-ins and user changes, and refused attempts | `activity.view-all` | Yes | No | No | No |

Nobody can edit or delete an activity event. There is no permission for it.

### Clients and contacts (v0.2)

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| View client organizations and contacts | `client.view` | Yes | Yes | Yes | No (v0.6: own organization only) |
| Create a client organization | `client.create` | Yes | Yes | Yes | No |
| Edit a client organization | `client.edit` | Yes | Yes | Yes | No |
| Change a client's status, or mark it a demo | `client.set-status` | Yes | Yes | Yes | No |
| Create or edit a contact | `contact.edit` | Yes | Yes | Yes | No |

### Opportunities (v0.2)

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| View opportunities, without value | `opportunity.view` | Yes | Yes | Yes | No |
| View an opportunity's value and pricing | `opportunity.view-value` | Yes | Yes | No | No |
| Set an opportunity's value and pricing | `opportunity.set-value` | Yes | Yes | No | No |
| Create an opportunity | `opportunity.create` | Yes | Yes | Yes | No |
| Edit an opportunity | `opportunity.edit` | Yes | Yes | Yes | No |
| Move an opportunity to another stage | `opportunity.set-stage` | Yes | Yes | Yes | No |
| Set or clear a follow-up date | `opportunity.set-follow-up` | Yes | Yes | Yes | No |
| Change an opportunity's owner | `opportunity.set-owner` | Yes | Yes | No | No |
| Convert a won opportunity to a project | `opportunity.convert` | Yes | Yes | Yes | No |

A member can move an opportunity to `quoted` or `won` only after an admin or
manager has entered its value. Totals built from values, such as a pipeline
total on the dashboard, need `opportunity.view-value` too.

### Projects (v0.2 stub)

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| View projects | `project.view` | Yes | Yes | Yes | No (v0.6: own organization only) |
| Edit a project's name | `project.edit` | Yes | Yes | Yes | No |
| Complete or cancel a project | `project.set-status` | Yes | Yes | Yes | No |
| Change a project's owner | `project.set-owner` | Yes | Yes | No | No |

### Projects, tasks, notes and files (v0.3)

Decided 2026-11-16 while Mikey was away. Needs his approval. Every role holds
all eight, on the same reasoning as the client permissions above: a member
does all the client work except deal values.

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| Add phases and milestones, and mark a milestone done | `project.plan` | Yes | Yes | Yes | No |
| View tasks and the board | `task.view` | Yes | Yes | Yes | No |
| Add, edit and move tasks | `task.edit` | Yes | Yes | Yes | No |
| Read notes on a record you may see | `note.view` | Yes | Yes | Yes | No |
| Write a note on a record you may see | `note.add` | Yes | Yes | Yes | No |
| Upload a file | `file.upload` | Yes | Yes | Yes | No |
| Download a file | `file.download` | Yes | Yes | Yes | No (v0.6: own organization's shared files only) |
| Add a deliverable, share it with the client or stop sharing | `deliverable.edit` | Yes | Yes | Yes | No |

`project.edit` now covers a project's name, description, health and dates.
Choosing your own theme needs no permission, like changing your own password.

### Proposals (v0.4)

Decided 2026-11-16 while Mikey was away. Needs his approval. A proposal is
all prices, so these follow `opportunity.view-value`: admin and manager only.

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| View proposals, their versions and the PDF | `proposal.view` | Yes | Yes | No | No (v0.6: own organization's shared proposals only) |
| Start a proposal and edit its working copy | `proposal.edit` | Yes | Yes | No | No |
| Send a version, and share a proposal with the client | `proposal.send` | Yes | Yes | No | No |
| Record the client's answer and the signed agreement | `proposal.decide` | Yes | Yes | No | No |

Sending a proposal prices its opportunity and moves it to `quoted`. Accepting
one wins the opportunity, starts the project and sets its baseline. Each is
one change under the proposal's own permission: the person does not also need
`opportunity.set-value` or `opportunity.convert`. A project's baseline is
shown only to those with `opportunity.view-value`.

### Time, expenses and budgets (v0.5)

Decided 2026-11-16 while Mikey was away. Needs his approval. The roadmap says
finance views need a permission a member does not hold by default.

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| Log your own time, run your timer, see and remove your own entries | `time.log` | Yes | Yes | Yes | No |
| See and remove everyone's time entries | `time.view-all` | Yes | Yes | No | No |
| Record and remove expenses | `expense.edit` | Yes | Yes | No | No |
| View budgets, costs, margins and payment status | `finance.view` | Yes | Yes | No | No |
| Set a project's budget, hourly rate and payment status; draft, send and withdraw change requests, and record a client's answer given by phone or email | `finance.edit` | Yes | Yes | No | No |
| Export time, expenses and summaries as CSV | `finance.export` | Yes | Yes | No | No |
| View invoices, their payments and the PDF | `invoice.view` | Yes | Yes | No | No (v0.6: own organization's sent invoices only) |
| Draft, send and void an invoice | `invoice.edit` | Yes | Yes | No | No |
| Record a payment received | `payment.record` | Yes | Yes | No | No |

Moving a task to "working on" starts the mover's timer under `task.edit`. A
person without `time.log` moves the task and gets no timer. Someone else's
time entry answers "not found" to a person who may see only their own.

### The client portal, HQ's side (v0.6)

Decided 2026-11-16 while Mikey was away. Needs his approval.

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| See who at a client has portal access, and what clients wrote | `portal.view` | Yes | Yes | Yes | No |
| Invite a client user, make them a new link, turn their access off or on | `portal.manage` | Yes | Yes | No | No |
| Post an update on a project for the client to read | `project.post-update` | Yes | Yes | Yes | No |
| Confirm or decline a call a client asked for, and see, cancel or move booked calls | `call.respond` | Yes | Yes | Yes | No |
| Set the hours for booked calls, days off, and who can book; link calendars; paint days from Timeful or Calendly; make and withdraw booking links | `booking.manage` | Yes | Yes | No | No |
| Make, change and remove referral links, and see their scans and inquiries | `referral.manage` | Yes | Yes | No | No |
| Set a client's website up for editing, change its content, send a client's changes back, and publish them to the site | `site.publish` | Yes | Yes | No | No (see below) |

A client user holds no permission key. Signed in to the portal, they may
change the content of their own organization's website and send the changes
in: the organization comes from their session and from nothing they send.
Nothing they change reaches the site until someone with `site.publish`
publishes it. The list of sites and what is waiting on each is seen with
`client.view`.

### Platform (v1.0)

Decided 2026-11-16 while Mikey was away. Needs his approval.

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| Read and search the knowledge base and the decision log, with every revision | `knowledge.view` | Yes | Yes | Yes | No |
| Write, edit, archive and bring back an article or a decision | `knowledge.edit` | Yes | Yes | No | No |
| View the reports: pipeline, project health, budget against actual | `report.view` | Yes | Yes | No | No |

The user permissions of v0.1 (`user.invite`, `user.set-status`,
`user.set-roles`, `user.reset`) are now used by the People page. Three rules
sit on top of them:

- HQ always has an admin who can sign in. The last active admin cannot be
  turned off or lose the admin role.
- Nobody turns off their own account.
- Importing clients from a pasted list (Clients → Import) has no key of its
  own: it takes every key adding them by hand would (`client.create`,
  `contact.edit`, `opportunity.create`, `opportunity.set-value`,
  `opportunity.set-stage`, `opportunity.convert`, `project.edit`), so only
  managers and admins can.
- An invited person gets their roles when they first use their link. Until
  then they are an invite, not a user, and an admin can withdraw it.

Search has no permission of its own. It looks only in the kinds of record
the person may already see: clients and contacts with `client.view`,
opportunities with `opportunity.view`, projects with `project.view`, tasks
with `task.view`, proposals with `proposal.view`, invoices with
`invoice.view`, and articles with `knowledge.view`.

The audit history page and its CSV need `activity.view-all`. The pipeline
report also needs `opportunity.view-value`, and the budget report
`finance.view`, so a role that is given `report.view` alone sees neither
prices nor costs.

Marking a milestone as the client's to do needs `project.plan`, like every
change to the plan. The dashboard's "From your clients" panel needs
`portal.view`. The notice sender runs by itself and has no permission key.

The restore drill, the full export, the retention run and the reset-link
command are run on the server or on Mikey's own computer. They have no
permission key: whoever can run them already holds the database.

## Client users

A client user holds none of the permissions above, and no role. They sign in
at `/portal` with an account that is kept apart from HQ's accounts, and an HQ
session is nobody in the portal. What a client user may do is fixed in the
portal's own services (`src/portal/application/client-side.ts`). Each one
takes the signed-in client's session, and reads and writes only records of
that session's organization. A record of another client, or one that was
never shared, answers "not found", the same as a record that does not exist.

| A client user may | Only when |
| --- | --- |
| See their organization's projects: status, health, milestones, the next one | The project belongs to their organization |
| Download a deliverable's file | The deliverable is theirs and has been shared with the client |
| Approve a deliverable, or ask for changes with a reason | It is shared and waiting for a decision |
| See a change request's price and hours, and approve or decline it | It is on their project, was sent to them, and is waiting for an answer. Drafts and withdrawn ones are not shown |
| Read the updates Potomac posted, and send a message back | On their own project. Internal notes are never shown |
| Send a file, and download a file they sent | On their own active project. Checked like every upload, at most 20 a day for a project |
| Read a proposal and download its PDF | It is theirs, it was sent, and Potomac turned on sharing for it |
| Accept or decline a proposal by typing their name | It is waiting for an answer |
| Download an invoice's PDF | It is theirs and was sent. Drafts and voided invoices are not shown |
| Ask for a call, and see the answer | Always |
| Mark the times they could do for a scheduling invite | It is for their organization and still open. Only Potomac’s free half hours can be picked |
| Sign up, confirm their email, and book a call | Anyone, while sign-up to book is on and email is set up. They become a client user of a new prospective client |
| Turn their own "something is waiting" emails off or on | Always. Only their own |

A client user never sees: another client, internal notes, tasks, time,
expenses, budgets, costs, margins, an opportunity's value, the pipeline, an
unshared proposal, a draft deliverable, a draft invoice, or any HQ page.

`test/integration/portal-isolation.test.ts` checks this on every merge. It
signs in as one client and tries every portal page, download and form
against another client's records, then every HQ page and every HQ form with
the client's session. The lists of HQ pages and forms are read from the
source, so a page added later is tried without anyone remembering to add it.

## Open items

1. **"Ask for a password reset link by email" was added while Mikey was away
   (2026-11-15)**, as part of "password reset by email" in
   `docs/scope-v0.1-v0.2.md`. Like signing in, anyone may ask. It answers the
   same whether or not an account exists, sends only to an active HQ user,
   and is limited to 5 asks an hour per address and 3 links an hour per
   email. Needs Mikey's approval.
2. **Whether refused attempts are written as activity events.** Not required
   by the roadmap. Clients can sign in from v0.6, and a refused attempt is
   still not written.
