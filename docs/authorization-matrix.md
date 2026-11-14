# Authorization matrix

Status: approved 2026-11-14.

This lists every action in v0.1 and v0.2 and which role may take it. Each row
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
| View the list of users | `user.view` | Yes | Yes | Yes | No |
| Invite a user | `user.invite` | Yes | No | No | No |
| Disable or re-enable a user | `user.set-status` | Yes | No | No | No |
| Change a user's roles | `user.set-roles` | Yes | No | No | No |
| Send a user a password reset link | `user.reset` | Yes | No | No | No |

### Dashboard and audit (v0.1)

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| View the dashboard | `dashboard.view` | Yes | Yes | Yes | No |
| View recent activity on client records | `activity.view` | Yes | Yes | Yes | No |
| View the full audit history, including sign-ins and user changes | `activity.view-all` | Yes | No | No | No |

Nobody can edit or delete an activity event. There is no permission for it.

### Clients and contacts (v0.2)

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| View client organizations and contacts | `client.view` | Yes | Yes | Yes | No (v0.6: own organization only) |
| Create a client organization | `client.create` | Yes | Yes | Yes | No |
| Edit a client organization | `client.edit` | Yes | Yes | Yes | No |
| Change a client's status | `client.set-status` | Yes | Yes | Yes | No |
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

## Client users

The Client user column is a placeholder. Until v0.6 a client user cannot sign
in at all. At v0.6 every client permission is scoped to the client's own
organization, and the cross-client test suite checks it on every merge.

## Open items

1. **Whether refused attempts are written as activity events.** Not required
   by the roadmap. Useful once clients can sign in.
