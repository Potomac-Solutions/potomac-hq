# 0006. Billing a client for a renewal, a week before it renews

Status: decided 2026-11-23 at Mikey's request, for Better Days Towing's
domain, which renews on December 2 ("he should probably need to pay a week
ahead of time really so I know whether to lapse the domain or not … to set
the precedent", and "I want him to be able to see it and … pay for it
directly in the portal"). Built by Claude. The choices marked **needs
approval** are his to confirm.

## Context

HQ keeps each client's renewals: domains, hosting, certificates, licenses,
what each costs Potomac and what Potomac bills. Nothing tied a renewal to an
invoice, and the client saw nothing of it. A domain Potomac pays for on a
client's behalf needs an answer before it renews: renew it or let it go.

## Decision

- **A client pays a week before it renews** (`PAY_AHEAD_DAYS = 7`). That is
  the invoice's due date. Billed later than that, it is due the day it is
  billed.
- **"Bill the client"**, on the client's page under Renewals, makes one
  invoice through finance (one line, kind "other", on one of the client's
  projects, chosen in the form) and sends it, and links it to the renewal
  for its coming term. Once a term: marking it renewed moves its date on,
  and the next term can be billed. Needs `client.edit` and `invoice.edit`.
  **Needs approval**: HQ doesn't bill on its own. A button is pressed for
  each, so a renewal is never billed by surprise.
- **The renewal says where it stands**: not billed yet, billed (pay by
  when), paid ("Renew it"), or not paid by its pay-by day ("Decide whether
  to renew it or let it lapse"), on Renewals and the client's page.
- **The client sees it** in their portal under "Coming up for renewal": what
  it is, the day it renews, the price, and the day to pay by. It shows two
  months ahead (`PORTAL_AHEAD_DAYS`), and for as long as it is owed. The
  invoice itself is in "waiting on you" and under Invoices, as every invoice
  is. What it costs Potomac is never shown. A renewal Potomac doesn't bill
  for isn't shown to the client.

## Paying in the portal

The portal shows what is owed and how to pay: by check or in cash. **Paying
by card in the portal is not built**: the card gateway is still to be chosen
(`docs/tool-boundaries.md`, open item 1), and HQ must never see a card
number. When the gateway is chosen, the invoice's "How to pay" gets a "Pay
by card" button, and the renewal follows its invoice by itself.

## Consequences

- ~~A client with no project in HQ can't be billed this way.~~ Since
  decision 0017 (2026-11-25), a renewal is billed on the client alone by
  default, or on one of their projects.
- Voiding the invoice puts the renewal back to "not billed".
- Changing a renewal's price after it is billed doesn't change the invoice.
