# 0025. Removing a member from HQ

Status: decided 2026-11-27 at Mikey's request ("i would also like to be able
to delete a member from the hq, at the moment i can only disable a user").
He chose the first option on both questions below. Built by Claude.

## Context

HQ could only turn an account off. A turned-off person stays on the People
page and in the list of who can be chosen, forever. The data model said
"users are disabled, never deleted": about ninety kinds of record name a
user, and many of them are history that must stay as it was. The activity
log is append-only. Time entries, invoices and payments are finance records,
which HQ removes none of until the accountant says how long to keep them.

## Decision

**Delete member** removes the person from HQ and keeps their name on past
work. Asked in two parts:

1. *What delete means.* Chosen: **remove, keep name**. Rejected: erase their
   name too (past work would say "Former member", and the record of who did
   what would be lost); delete only people with no records (anyone who ever
   worked could still only be turned off); a full delete when they have no
   records and remove otherwise (two behaviours behind one button).
2. *Their open work.* Chosen: **choose who takes it**, defaulting to the
   person removing them. Rejected: always to the remover; refuse until it is
   moved by hand.

### What happens

- Their **user row stays**, so every record that names them still does. It is
  turned off, marked removed (`removed_at`), loses every role, and its email
  becomes `removed-<id>@removed.invalid`, so the real address is free to be
  invited again. Someone invited again is a new user; past work stays under
  the old one.
- Their **sign-in account is retired** in the kit: turned off, every session
  ended, its password emptied and its email replaced the same way. The kit
  has no way to delete an account (to be filed upstream with
  `found-by: potomac`).
- **Their open work goes to the person chosen**: open deals (not won or
  lost), active projects, tasks and to-dos not done, upcoming calls they
  host, the booking calendar if they are its host, and filters they shared.
  A running timer is stopped at the moment of removal, so its time is kept.
- **What was only theirs is deleted**: preferences, two-factor sign-in and
  recovery codes, passkeys, their calendar feed (its link stops working),
  private filters, the work-table columns, pins, notices and reminders,
  phone alerts, assistant chats, undo history and an unfinished task import.
- **Everything else stays as it was**: the activity log, time, expenses,
  invoices and payments, notes, comments, files, proposals, calls, touches
  and every "made by". Refused sign-in attempts stay for their 90 days.
- One activity event, `user.removed`, names who took the work over and how
  much moved.

### Rules

- Admins only: a new permission, `user.remove`.
- Nobody removes themselves. The last active admin cannot be removed.
- The person taking over must be an active member of HQ, and not the one
  being removed.
- It cannot be undone from HQ. Turning someone off still can, and stays the
  way to stop someone signing in for now.
- A removed person no longer shows on the People page or anywhere a person
  is chosen. The audit history can still be filtered by them.

## Consequences

- Migration 0094 adds `user.removed_at` and the permission.
- `docs/data-model.md` now says "disabled or removed, never deleted".
