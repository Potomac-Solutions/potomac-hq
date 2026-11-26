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

## Third part, the same day: billing extras

Mikey asked for every idea offered after the second part ("Do all of these").
Sales tax was left out: it needs the accountant's answer first. Migration 0081
adds what they need.

- **Promise to pay** (`invoice.promised_on`, `promise_note`): from a call,
  on a sent invoice. Today says "<client> promised to pay INV-0004" that day,
  overdue after it, until it's paid.
- **Card payment link** (`invoice.pay_link`): one Potomac makes in its own
  payment service and pastes in; https only, no sign-in in it. The portal
  shows "Pay by card" on that invoice. HQ connects to no payment service.
- **Write-off** (`written_off_on`, `written_off_note`): a sent invoice is
  voided with a reason and reads "Written off", so a mistake stays a
  mistake. Payments already received stay.
- **Draft and send in one step** for a one-off charge.
- **Billing contact** (`client_organization.billing_contact_id`): one of the
  client's contacts with an email. Reminders, receipts and statements go to
  them; otherwise the usual people.
- **The client's money line**: owed now, overdue, paid this year, the next
  renewal and prepaid hours left, at the top of the client's page.
- **Prepaid hours** (`prepaid_block`): blocks bought, in quarter hours, with
  an optional invoice. Time logged on the client's projects from the first
  block on draws them down. Low is a fifth left or two hours; Today warns.
- **Recurring invoices with no project** (`recurring_invoice` rebuilt with
  `organization_id`, `project_id` optional): hosting, upkeep, a plan.
- **Renewals billed together**: ticked renewals of one client, one invoice,
  a line each, due a week before the first renews.
- **A renewal's price change** (`price_was_minor`, `price_changed_on`): the
  portal says "New price from your next bill" for about four months.
- **Renewals → the next 12 months**: each time each renewal comes up, what it
  costs and is billed, what renewals earn, and any billed at a loss.
- **Receipts** (`payment_receipt`), every five minutes, for payments
  recorded in the last three days, and **monthly statements**
  (`client_statement`) in a month's first week, to clients who owe. Both
  only with invoice emails on; each once.
- **How to pay** (`finance_setting.pay_instructions`), set on the Money page,
  in the portal, reminders, receipts and statements. A card or account
  number is refused: every client sees it.
- **A yearly payments download** in the portal, a CSV of what the client
  paid, for their taxes or bookkeeper.
- **The free page and its own domain together** in the portal.
- **Money → Cash forecast**: 13 weeks from this Monday. In: sent invoices by
  due day (overdue ones this week), renewals not billed by pay-by day,
  recurring invoices as HQ will make them. Out: renewal costs on the day.
  Expenses aren't planned in HQ, and drafts aren't counted.
