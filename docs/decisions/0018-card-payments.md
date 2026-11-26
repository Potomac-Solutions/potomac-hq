# 0018. Card payments in the portal, on a payment platform Mikey can change

Status: decided 2026-11-26 at Mikey's request ("I want a component that can
allow me to easily integrate with any payment API. I'm not sure which one to
go with ... by changing an attribute"; platforms: Stripe, Square, PayPal,
Helcim, and Link; the platform's own page for the card; "Kit, then HQ").
Built by Claude.

## Context

Tool boundaries rule 1 says HQ never sees a card number, and its open item 3
said the payment page "waits on the card gateway". Until now "Pay by card"
was a link Mikey made by hand in a payment service and pasted on each
invoice (decision 0017), and he then recorded the payment by hand. He has
not chosen a gateway and does not want that choice built in.

## Decision

1. **The kit owns it.** `kit/pay` already kept "an order is charged at most
   once". It now also pays on a platform's own page: `start`, `settle`,
   `heard` (a webhook) and `refund`. `kit/pay/providers` puts Stripe, Square,
   PayPal and Helcim behind the same four functions, and `pay-button` is the
   component. Which platform is one name. HQ is the first app to use it.

2. **One setting chooses the platform.** `HQ_PAY_PROVIDER` is `stripe`,
   `square`, `paypal`, `helcim` or `test`, with that platform's keys in
   `HQ_PAY_<PLATFORM>_*`. Nothing else in HQ changes with it. Unset, card
   payments are off and the pasted link of decision 0017 still works.
   Link is not a platform of its own: it is a way to pay on Stripe's page,
   turned on in the Stripe Dashboard.

3. **The card is typed on the platform's page, never HQ's.** Rule 1 stands
   unchanged. Stripe, Square and PayPal have a page HQ sends the client to.
   Helcim has none, only a frame of its own; HQ serves one page around that
   frame, and that page alone lets Helcim's addresses in.

4. **What the client does.** Every sent invoice with money owed has **Pay by
   card** in the portal. It asks for what is still owed, so a part payment
   by check and the rest by card works. The button goes to a step of HQ's
   that names the amount and sends the browser on; a plain redirect can't,
   because HQ's forms may only go to HQ (its content security policy), and
   that stays so.

5. **HQ believes only the platform.** Coming back to HQ, or a webhook
   arriving, is only a reason to ask the platform whether the payment HQ
   started was paid, for the amount HQ started. Then the payment is recorded
   on the invoice once: method card, the platform's own reference, the
   activity "A client paid an invoice by card" with no actor. The payment row
   needs a person, so it carries whoever made the invoice. The receipt email
   and the project's payment status follow as for any payment.

6. **Money HQ can't place is written down, not dropped.** Paid at the
   platform after the invoice was voided or paid another way, paid twice from
   two tabs, or for a different amount: nothing is recorded as a payment, the
   activity "A card payment came in that HQ couldn't put on its invoice"
   carries the platform's reference, and the client is told Potomac will be
   in touch. Refunding is done at the platform; HQ has no refund button yet.

7. **Test mode.** `HQ_PAY_PROVIDER=test` shows the whole path with a
   stand-in for the platform's page and moves no money. The portal, the
   invoice page and System status all say so.

8. **HQ uses PayPal** (Mikey, 2026-11-26: "we will use PayPal on hq"). The
   setting is still the only place that says so. Two things follow from how
   PayPal works. It takes the money only when HQ asks, after the client
   approves, so HQ asks on the client's return and on PayPal's webhook, and
   **never asks for an invoice that is no longer open or no longer owes what
   it did** (voided, written off, or paid by check meanwhile): the approval
   lapses at PayPal and nothing is charged. And a client who backs out at
   PayPal comes back to "You left before paying, so nothing was charged."

## Not decided here

- Which platform the kit's other apps use. That is the point.
- Saved cards and subscriptions. The platforms differ too much to sit behind
  one name; HQ makes its own recurring invoices, each paid like any other.
- Fees: passing the platform's fee on, or a discount for a check.
- A refund button in HQ, and paying a deposit by card when accepting a
  proposal.

## Consequences

- No migration. The kit's documents live in `kit_document`, as staff
  accounts and portal sign-ins do.
- HQ depends on the kit at a commit that has `kit/pay/providers` (0.9.0).
- None of the four platforms has taken a real payment through this yet.
  Their calls are written from their published APIs and tested against a
  faked `fetch`. Before real invoices: set the platform's sandbox keys on a
  staging HQ, pay an invoice, and see it recorded. Helcim's is the least
  sure (docs/operations.md, "Card payments").
- `/pay/webhook/<platform>` is the one address in HQ that accepts a post
  that is not a form from HQ itself.
