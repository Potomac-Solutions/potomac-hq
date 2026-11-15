# Tool boundaries

Status: approved 2026-11-14. Source: M0 discovery interview.

This says which jobs HQ does itself, which stay in an outside tool, and how
each job is done before HQ can do it.

## Change from the roadmap

The Implementation Roadmap says HQ links to outside tools for accounting and
invoicing, email, file storage and contract signing, and does not replace
them. Potomac chose to build invoicing, booking, contract signing and the
payment page inside HQ. Outside tools stay only where building them would be
unsafe or pointless: card processing, the tax books, mail delivery and raw
file storage.

Booking is new scope the roadmap does not list. It is placed at v0.6 because
it needs the client sign-in.

## Boundaries

| Job | Until HQ has it | Built in HQ | Stays outside for good |
| --- | --- | --- | --- |
| Invoicing | Paper or emailed invoice | v0.5: invoices and payment status | Nothing |
| The books | Google Sheet | v0.5: one-way sync from HQ to the Google Sheet, plus CSV export | The ledger and tax records |
| Payments | Cash or check, recorded by hand | v0.6: payment page in the portal | Card gateway (undecided) |
| Inbound email | Gmail, reached through Cloudflare Email Routing | Nothing | Gmail and Cloudflare Email Routing |
| Outbound email | A server command prints the password reset link | v0.2: HQ sends through an adapter behind the kit's `notify` interface | Sending service: Brevo |
| Booking | Phone or email | v0.6: booking tool in the portal | Nothing |
| Contract signing | Printed, signed and scanned | v0.4: typed acceptance recording name, time and proposal version | Nothing |
| File storage | n/a | v0.3: file service with authorized downloads | Cloudflare R2 holds the bytes |

## Rules

1. **HQ never sees a card number.** The payment page sends card details
   straight to the gateway. HQ stores the gateway's reference and the payment
   status only.
2. **The Google Sheet is the book of record for taxes.** HQ's revenue and
   margin figures are operational estimates. The sync runs one way, from HQ to
   the sheet. HQ never reads the sheet back.
3. **Cash and check payments are entered by hand** and written as activity
   events like any other change.
4. **Paper is always allowed.** A client can sign a printed agreement and pay
   cash. HQ records the result and, from v0.3, stores the scan.
5. **Every outside service sits behind an interface in the infrastructure
   layer** with one adapter, so replacing Brevo with another sender, or R2 with
   another store, changes one file.
6. **Typed acceptance is checked with a lawyer before it is relied on for a
   large contract.**

## Data protection

- The database is encrypted at rest.
- A backup runs every day. Each backup is encrypted before it leaves the
  server, with a key only Mikey holds. The key is never stored on the server
  or in the repo.
- Backup copies are kept in Cloudflare R2.
- A restore is tested at every release, as the roadmap requires.

## Open items

1. **Card gateway.** Needed before v0.6.
2. **Which Google Sheet, and its column layout.** Needed before v0.5.
