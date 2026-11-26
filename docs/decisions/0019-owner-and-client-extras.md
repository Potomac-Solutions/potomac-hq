# 0019. Eleven extras for clients and for running the business

Status: decided 2026-11-26 at Mikey's request ("What other features would
help either clients or us as the owners of the company?", then "Iterate on
each of these in a new branch"; HQ uses PayPal, decision 0018). Built by
Claude on `feat/owner-and-client-extras`, one commit each.

## Context

With card payments in (decision 0018), the gaps left were the ones a small
web business feels every week: chasing deposits and plan bills by hand,
asking for logos and logins over a week of emails, change requests lost in
texts, nobody calling about a late invoice, not knowing which clients pay,
and a tax-time scramble. Clients, for their part, had no one place to ask
for a change, tell us about their business, or say how a project went.

## Decision

1. **Refunds.** A payment on an invoice can be given back in part or in
   full: through the payment platform when it came by card, or recorded by
   hand when the money went back another way. A paid invoice goes back to
   sent only when the person says the payment didn't stand (a bounced
   check, a dispute); otherwise, and by default, what was given back is no
   longer owed and is written off with the reason. Money reports, the payments export and the weekly email
   count refunds. Uses `payment.record`. Table `payment_refund`.

2. **Deposit at acceptance.** When a client accepts a proposal in the
   portal and card pay is on, the drafted deposit invoice is sent at once,
   and a ticked box takes them straight to pay it.

3. **Request box** (`/portal/requests`). A client asks for a change in a
   sentence or two, on a project or not; it becomes a task for whoever
   owns the project (or the client) and the client sees where it stands.
   Twenty a day at most. Staff may decline one with a reason (`task.edit`).
   Table `client_request`.

4. **Intake** (`/portal/intake`). One form for name, hours, colors, logo,
   photos and which accounts we'll need. It never asks for or keeps a
   password: anything that looks like one is refused. Files go to their
   newest active project. Table `client_intake`.

5. **How did we do.** A finished project asks the client for 1 to 5 and a
   note. 3 or under makes a to-do to call them; 4 or 5 invites a review when
   they may still write one. Table `project_feedback`.

6. **Late fees and a call.** Off until set on the Money page: a flat amount
   or a percent, after so many days late, once per invoice, as its own sent
   invoice due in 14 days. A fee never reaches back: an invoice already past
   its day when the fee was set (or changed) is left alone. Fourteen days late, a to-do to call the client,
   once. Daily at 08:52. Tables `late_fee_setting`, `invoice_late_fee`,
   `invoice_late_call`.

7. **Profit by client** (`/money/clients`). For a year: invoiced, paid,
   expenses on their projects, and renewal costs, with what's left, so the
   clients that cost more than they pay show. `finance.view`.

8. **Tax pack.** One zip a year from the Money page: income, income by
   client, expenses, expenses by category, owed at year end, written off,
   and the receipts, with a README for the accountant. `finance.export`.

9. **Handoff pack.** From a client's page: one zip for a client who is
   leaving or hosting their own site. Renewals with what they cost at the
   provider (never our price), their sites and where the code is, the
   latest built site's files, the files shared with them, their invoices
   (for someone with `invoice.view`), what they told us at intake, and next
   steps for moving a domain. `client.set-status`.

10. **Text reminders.** A client person turns texts on in the portal with
    their own US mobile number and a ticked yes. They then get the
    day-before call reminder and invoice reminders by text as well as
    email, nothing else. Reply STOP or the portal turns them off; Twilio's
    "unsubscribed" error stops us too. Each text is logged. Off unless
    `HQ_TWILIO_ACCOUNT_SID`, `HQ_TWILIO_AUTH_TOKEN` and `HQ_TWILIO_FROM` are
    set, and texts go out with the email reminder runs (so they need email
    set up too). Tables `text_consent`, `text_sent`.

11. **Autopay for plans.** A client with a plan (an active recurring
    invoice) saves their PayPal account once from the portal, through
    PayPal's Payment Method Tokens API, with no purchase. HQ keeps only
    PayPal's token. Each plan invoice is charged the day it's sent (daily at
    10:17), retried 3 and 7 days after a decline, and then a to-do. Each try
    is written before PayPal is asked and carries a request id, so a repeat
    is the same charge at PayPal; a try with no clear answer is never
    repeated by itself, it becomes a to-do to check PayPal. Stopping, from
    the portal or the client page, removes the saved account at PayPal.
    The client's portal says where each plan bill stands: to be paid
    automatically (so not "waiting on you"), declined with the day of the
    next try, or theirs to pay after three tries.
    Only plan invoices, never one-off ones. Only on PayPal for now: the
    other platforms of decision 0018 would each need their own saved-method
    calls. Tables `autopay`, `autopay_charge`.

## Consequences

- No new permissions: each extra uses one the authorization matrix already
  has, named above.
- Autopay needs **Vault** turned on for HQ's PayPal REST app (in PayPal's
  developer dashboard, under the app's features), and PayPal may need to
  approve the account for saving PayPal accounts. Try it in the sandbox
  first. The calls follow PayPal's documentation; they have only been run
  against a stand-in, not PayPal itself.
- An autopay payment is refunded by hand (the refund fold-out's "I gave it
  back myself"), and then in PayPal; it isn't tied to the kit's card
  payment record that "through the platform" refunds use.
- Text reminders in the US need the sending number registered for A2P 10DLC
  with Twilio before carriers deliver them reliably.
- Open: moving saved methods and charging them into `kit/pay`, so another
  project, or another platform, gets autopay by the same one setting.
