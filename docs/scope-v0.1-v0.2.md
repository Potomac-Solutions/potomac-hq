# Scope for v0.1 and v0.2

Status: approved 2026-11-14.

The roadmap's last M0 item is to cut v0.1 and v0.2 to the smallest scope that
supports the first slice: prospect → contact → opportunity → follow-up →
project. This is that cut. Two facts from discovery drive it: HQ has one user
for now, and there are no existing clients to bring in.

## v0.1 Foundation

### Keep

| # | Item | Smallest version |
| --- | --- | --- |
| 1 | Repo and CI | Done in the scaffold. Add: deploy to Railway when `staging` or `main` changes |
| 2 | Environments | Local, test (from `staging`) and production (from `main`). Secrets in Railway. Migrations run by the deploy |
| 3 | Sign-in | The kit's `staff` module and its pages: first-owner setup link, sign-in, sign-out, change password. A rate limit on the sign-in route |
| 4 | Users and roles | User, Role, RolePermission and UserRole tables. The three roles seeded by a migration. One `can(user, action, record)` check |
| 5 | Audit | The append-only Activity Event table, the triggers that reject updates and deletes, and one helper every use case calls |
| 6 | Shell | Navigation, layout, error and empty states, on Zubra UI with a Potomac theme, keyboard accessible |
| 7 | Dashboard | One panel: recent activity, read from the audit table |
| 8 | Backups | Nightly encrypted backup to R2, and one restore into the test environment |

### Cut from v0.1

| Cut | Why | Lands |
| --- | --- | --- |
| Inviting, disabling and re-roling users | There is one user. The permissions stay in the matrix, the screens and services wait | When a second person joins, or v1.0 |
| Password reset by email | Needs the sending service. Until then, a command run on the server prints a one-time reset link | v0.2, with reminders |
| Wiring the sending service (Brevo, chosen 2026-11-14) | Nothing in v0.1 sends email after the cut above | v0.2 |
| Placeholder dashboard panels for pipeline and projects | Empty boxes are not real use | v0.2 fills them |
| A dark theme and its toggle | Not needed to use HQ on day one. The Potomac theme defines its colours as light and dark pairs from the start, so adding dark mode later changes no component | v0.3. Tracked as issue #2 |

### Gate

You sign in to production HQ, the dashboard shows your own sign-in in the
activity panel, CI is green, and one backup has been restored into the test
environment. Unchanged from the roadmap.

## v0.2 CRM and the first slice

### Keep: pass 1, the slice end to end

1. Create a prospective Client Organization, with a size tier.
2. Add a Contact to it.
3. Create an Opportunity with a service, stage, lead source, and (for an
   admin or manager) pricing and value.
4. Move it through its stages, set a follow-up date, and see it on the
   dashboard when due.
5. Convert a won Opportunity into a Project stub, `fixed` or `ongoing`.

Each step gets a domain rule, an application service with its permission
check and activity event, a route, a screen and an end-to-end test.

### Keep: pass 2, widened only this far

| Item | Smallest version |
| --- | --- |
| Client status | `prospective`, `active`, `inactive`, `former`, with `active` set when the first opportunity is won |
| Lists | One list each for clients and opportunities, newest first, with a filter by status or stage |
| Pipeline view | Opportunities grouped by stage. Moving a stage is a button, not drag and drop |
| Dashboard | Two panels added: open opportunities and follow-ups due |
| Reminders | In-app only: the follow-ups-due panel |
| Outbound email | Brevo is wired behind the kit's `notify` interface, used for password reset |

### Cut from v0.2

| Cut | Why | Lands |
| --- | --- | --- |
| Import of existing contacts and prospects | There are none to import | If a list ever needs importing |
| Notes and interaction history | The opportunity's `summary` field holds the consult summary for now | v0.3, with project activity history |
| Follow-up reminders by email | The dashboard panel is enough for one user | When a second user joins |
| Search and sort on lists | A filter is enough at this volume | When a list passes a screenful |
| Drag and drop on the pipeline | A button does the same job | v0.3, with the project board |

### Gate

The slice's end-to-end test runs in CI, and every real prospect is entered in
HQ from the first one onward. The roadmap's "old tracking method is retired"
does not apply, because there is no old method.

## Decided: the `shared/domain` exception

Any module's domain may import `src/shared/domain`, and nothing else outside
its own folder. `shared/domain` itself imports nothing. It holds the few small
types every module needs, such as an id and money. The boundary lint enforces
both halves, and its self-test covers them.

Other layers still reach the shared module through `src/shared/index.ts`.
