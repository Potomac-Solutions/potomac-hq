# Retention policy

Status: decided 2026-11-16 while Mikey was away. Needs his approval, and a
lawyer's or accountant's check of the periods marked below.

What Potomac HQ keeps, for how long, and what removes it.

## What HQ removes by itself

Each night at 4:07 AM Eastern, and whenever `npm run retention` is run:

| What | Kept for | Why |
| --- | --- | --- |
| Sign-in sessions that have ended or expired, for HQ and for the portal | 30 days after they stopped working | They are no use after that. 30 days leaves time to look into a sign-in problem |
| A session's two-factor pass | With its session | It means nothing without the session |
| A refused attempt (wrong password or code, a form someone was not allowed to use) | 90 days | Long enough to see a pattern. It can come from anyone, so it is not kept for good like the activity log |
| One-time links (setup, invite, password reset) that expired or were used | 30 days after they stopped working | The same |
| Invites to HQ that nobody used | 30 days | The link stopped working after 7 |

A run that removes something writes one activity event with the counts. A
run that removes nothing writes none.

## What HQ keeps

| What | Kept for | Why |
| --- | --- | --- |
| The activity log | Always | It is the audit history. The database refuses any edit or delete of it |
| Invoices, payments, time entries and expenses, with receipts | Always, for now | Tax records. **The period needs an accountant's answer.** Seven years is common advice. HQ removes none until that is decided |
| Proposals, their sent versions, decisions and signed agreements | Always | They are the record of what was agreed |
| Clients, contacts, opportunities, projects, tasks, notes, deliverables and files | While Potomac is in business, unless a client asks otherwise | Work history. See "When a client asks" |
| Knowledge base articles and every revision | Always | Archived, never deleted |
| Removed time entries and expenses | Always | Marked removed and kept, so the record shows what was changed |
| User accounts that were turned off | Always | The activity log names them |

## Backups

A backup is a sealed copy of everything above as it was that night. Nightly
backups go to the R2 bucket. **How long the bucket keeps them is set on the
bucket, not in HQ**: set a lifecycle rule there. Recommended: keep 35 days of
nightly backups. Something removed from HQ stays in older backups until they
age out.

## When a client asks for their records, or asks for them to be removed

HQ has no button for either yet. Both are done by hand, by Mikey:

- **A copy of their records:** `npm run export` writes everything. Take that
  client's rows from it.
- **Removal:** money records and anything the audit log refers to are kept
  (see above). Contact details can be blanked by editing the contact. A
  request to remove more than that needs a decision about what the law
  requires Potomac to keep, and then a migration written for it.

## What HQ never holds

Card numbers (`docs/tool-boundaries.md`, rule 1), passwords in readable form,
and the private key that opens backups.
