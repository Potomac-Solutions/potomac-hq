# 0017. Invoices on a client, and free pages on a client's own domain

Status: decided 2026-11-25 at Mikey's request ("I want to bill him for just
the domain name, but I can't seem to do so without starting a project", and
"what if I'm doing a free landing page but they are opting to let me pay for
their domain"; "Both"). Built by Claude.

## Context

Every invoice had to be on a project (migration 0007). Decision 0006 said
so: "a client with no project in HQ can't be billed this way". Better Days
Towing's site is long built and live at its own domain; all he owes now is
the domain. And a free landing page could only live at a name on
potomac.solutions, though the price guide offers domains at their cost plus
$10 a year.

## Decision

- **Every invoice names its client; its project is optional** (migration
  0078). The invoice table is rebuilt with `organization_id`, filled from
  each invoice's project, and `project_id` may be empty. Numbers, ids and
  payments are kept.
- **Without a project, an invoice is "full" or "other".** A deposit or a
  balance is against a project's budget, so it needs one, in the domain rule
  and in the table.
- **On the client's page, Invoices** lists all of a client's invoices and
  drafts a one-off charge on the client alone (`invoice.edit`). It is a
  draft until sent, like any other.
- **Renewals bill the client alone by default.** "Bill the client" offers
  "The client, no project" first, then their projects.
- **A free page has one address: a name on potomac.solutions, or the
  client's own domain** (migration 0079, `free_page.own_domain`, unique).
  With its renewal date, cost and price, saving adds the domain to the
  client's Renewals, yearly, ready to bill; it isn't added twice.
- Nothing about a project moves when a client-only invoice is paid: there is
  no project payment status to move.

## Consequences

- Portal, reminders, Today, search, client reports and referral credit read
  the invoice's own client, not its project's.
- A client-only invoice reads "No project" on the client's page, and its
  page's breadcrumb leads to the client, not a project's Money page.
- Reminder emails leave out "for <project>" when there is none.
- Decision 0006's "needs a project" consequence no longer holds.

## Added the same day: billing renewals in time, and the client's answer

Asked for by Mikey after a look at what admins, managers and clients see.

- **Today says to bill a renewal from 30 days before it renews** ("Bill
  betterdaystowing.com", due a week before it renews), so the bill goes out
  before the client's pay-by day. Before, a renewal showed on Today only in
  the week it renewed, already past that day. Once the pay-by day passes
  unpaid, Today says it "isn't paid", to decide.
- **The client answers in the portal: "Renew it" or "Let it lapse"**
  (migration 0080, on `renewal`: the answer, the renewal date it was for,
  when, and who). An answer counts for one term; marking it renewed starts
  the next term unanswered. They may change their mind until the day it
  renews, but not once it's paid. A renewal they let lapse isn't offered for
  billing, and Today says "Let <it> lapse". Every answer is in the activity
  log, by the client user.
- **Money → Invoices** lists every invoice, filtered by where it stands, with
  what's owed, what's overdue, drafts not sent, and who owes what.
- **The portal names a no-project invoice by its first line** ("Domain name,
  one year"), not a vague "for your business".
