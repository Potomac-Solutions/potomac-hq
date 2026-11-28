# 0023. Deleting into the Trash

Status: decided 2026-11-27 at Mikey's request. He has test clients,
contacts and proposals he wants to purge, and couldn't: nothing in HQ could
be deleted. He chose each option below. The two choices he didn't make
were Claude's picks, and he confirmed both on 2026-11-27.

## Decision

### 1. What can be deleted

A **client**, a **contact**, a **deal**, a **proposal** and a **project**.
Each goes with everything that belongs to it:

- **A client:** its contacts, deals, proposals, projects, tasks, time,
  expenses, invoices, payments, files, notes, portal people, bookings,
  renewals, sites and the rest.
- **A deal:** its proposals, and its project if it was won.
- **A proposal:** its versions, the client's answer and any agreement.
- **A project:** its phases, milestones, tasks, time, expenses, invoices,
  deliverables and files.
- **A contact:** only the contact. If they were the last contact at the
  client with their email, that person's portal access there is turned off
  (decision 0022), not deleted: their messages and approvals stay. Putting
  the contact back turns it on again, unless someone has changed it since.

What only *mentions* a deleted record stays, with that link cleared: another
client's deal it referred, a logged call with a contact, the client's
billing contact. Restoring puts the link back.

**Confirmed:** invoices, tasks and other records aren't deleted one by one
here; they have their own void, archive and remove.

- **A portal person** (added 2026-11-28, Mikey's choice): one of a
  client's portal people, from *Delete* beside them under Client portal on
  the client's page. What they sent from the portal goes with them: their
  messages on projects, requests, call requests, invites to pick call
  times, intake forms, feedback and text-message records. What is the
  client's stays, with their name cleared: approvals and change decisions
  on deliverables, files they uploaded, bookings, renewal answers, autopay
  and QR codes. A task their request made stays. Their access at their
  other clients isn't touched, and their sign-in stays, as when all of
  someone's clients are deleted. Nothing they send holds money records, so
  a portal person is never refused. Putting them back fails if the same
  email has been invited at that client since.

### 2. The Trash, then purge (Mikey's choice)

- A delete moves the record and what went with it to the **Trash**, as an
  exact copy of every row, and removes them from HQ.
- An admin can **put it back** for **30 days**, exactly as it was. If
  something has taken its place since (say, a new contact with the same
  email at a client), nothing is put back and HQ says why.
- After 30 days the nightly run (4:07 AM) **purges** it. An admin can
  *Delete for good* sooner, or *Empty the Trash*; both ask first.
- The **activity log keeps** a line for each delete, put-back and purge. It
  is append-only, and the records it mentions may be gone.
- Every delete also offers **Undo** straight away, which puts it back.

### 3. Real money records stay (Mikey's choice)

- A record that would take **a payment** or **a signed agreement** with it
  is refused, unless its client is **marked a demo**. HQ says what it holds
  and suggests marking the client Former, or a demo if it was only a test.
- A demo client goes with everything, payments included.

### 4. Admins only (Mikey's choice)

A new permission, `record.delete`, for admins: delete, put back, purge and
see the Trash.

### 5. One at a time, or many (Mikey's choice)

- A **Delete** button on each client's, deal's, proposal's and project's
  page, and beside each contact.
- **Ticks** on the Clients and Proposals lists, with *Delete the picked
  ones*, and *Delete all demo clients*.
- Every delete first opens a page saying what each would take with it
  ("1 project, 14 tasks, 3 invoices and 40 other records") and which are
  kept and why. Up to 100 at a time. **Confirmed:** each record goes in its
  own transaction, so one that's refused doesn't hold up the rest.

### 6. How it works

- `src/trash/infrastructure/sqlite-trash.ts` finds what belongs to a record
  from the schema's own foreign keys, so a table added later goes with its
  owner without a change, as the client merger does. A row belongs when it
  points at a deleted row through a column that can't be empty, through
  one that names its owner (`organization_id`, `project_id`,
  `proposal_id`), or one the database would delete itself. Notes, AI
  drafts and files point at what they're on by kind and id, and go too.
- Foreign keys are checked when each delete commits: if anything still
  pointed at a deleted row, the whole delete is undone.
- A sent proposal version still can't be changed or deleted, except by the
  Trash while it holds a lock in its own transaction (migration 0092).
- Someone whose clients were all deleted keeps their portal sign-in, and
  inviting the same email again sends a link to set a new password with it.

## Not done

- Deleting invoices, payments or tasks on their own here.
- The Trash on a phone's tab bar; it's under Company and in search.
