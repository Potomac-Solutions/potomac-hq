# Workflow: first inquiry to a completed, paid project

Status: approved 2026-11-14. Source: M0 discovery interview.

This is how Potomac Solutions works a job, one step per line, with the record
each step touches. HQ is built to hold these records. Anything marked
**provisional** or listed under Open items is not decided yet.

## Services at launch

| Service | What the client gets | Price |
| --- | --- | --- |
| Consulting | Web and online consulting by call | First 30 minutes free, then $75/hr |
| Free landing page | One landing page hosted at `<name>.potomac.solutions`, four rounds of changes plus a final approval, and a zip of the site on request | Free. Further changes $50/hr, or quoted for larger work |
| Domain management | Domain registered and managed by Potomac | Cost of the domain + $10/yr |
| Multi-page website | A multi-page site with unlimited support and updates. No upfront build fee (**provisional**) | $50/mo or $500/yr |
| Blog platform | Blog added to a Potomac website and kept current. Add-on only | $10/mo |
| Social media marketing | Content creation for Facebook, Instagram and LinkedIn: 8 posts and 1 blog post a month, approved by the client each month (decision 0011) | $50/mo or $500/yr |
| Application development | A custom application | Quoted per project, roughly $1,000 to $5,000 |
| Automations | Workflow automations built on n8n | Quoted per project (**provisional**) |

Not offered at launch, under consideration: video ads.

### Pricing rules

- List prices are defaults. The price on each deal is recorded on that deal.
- Pricing scales with the client. Small local businesses pay less, larger
  companies pay more, and work built on an existing Potomac framework costs
  less than work built from nothing.
- Each client carries a size tier: `small` (mom-and-pop), `established`
  (established small business) or `large` (larger company). The tier is a
  guide for quoting, not a price formula.
- HQ handles five pricing shapes: free with a cap, hourly, cost plus a fee,
  recurring (monthly or yearly) and quoted fixed price.

## How client-facing steps run before the portal

The target workflow runs through a client portal, which ships at v0.6. Until
then each portal step runs by hand and Potomac enters the result into HQ
(decision: Option A, keep the roadmap order). Each step below shows both.

## Opportunity stages

`new` → `consult-booked` → `consulted` → `quoted` → `won` or `lost`

A free landing page skips `quoted`. An opportunity can move to `lost` from any
stage. A person can move one back to any earlier stage, put it back where it
was (Undo), or reopen a won or lost one at an open stage; a won deal that is
already a project stays won (decision 0014). Automatic moves, from booking,
proposals and import, only ever go forward one stage.

## The steps

### Shared start

| # | Step | Until the portal | With the portal (v0.6) | Record touched | In HQ from |
| --- | --- | --- | --- | --- | --- |
| 1 | An inquiry arrives, usually drawn by the free landing page or free consult | Phone, email or word of mouth. Potomac enters it | Client signs up for an account | Client Organization (`prospective`), Contact, Opportunity (`new`, with lead source) | v0.2 |
| 2 | Book the free 30-minute consult | Agreed by phone or email | Client picks a time in the booking tool | Opportunity (`consult-booked`, follow-up date set to the call) | v0.2 |
| 3 | Hold the consult. Gather enough to build without much back and forth. Wrap up at 25 minutes, summarize, and ask about a follow-up | Call | Call | Opportunity (`consulted`, summary note) | v0.2 |
| 4 | Client decides: free landing page, paid work, or nothing | Phone or email | Request made in the portal | Opportunity (service chosen, or `lost`) | v0.2 |

### Path A: free landing page

| # | Step | Until the portal | With the portal (v0.6) | Record touched | In HQ from |
| --- | --- | --- | --- | --- | --- |
| A1 | Client asks for the landing page | Email | Portal request | Opportunity (`won`, value $0), converted to a Project. Client Organization (`active`) | v0.2 |
| A2 | Build the page | n/a | Client can view progress | Project (`active`) | v0.2 stub, v0.3 full |
| A3 | Up to four rounds of changes | Email | Portal change requests | Project (round count) | v0.3 |
| A4 | Final approval | Email | Portal approval | Project, Activity Event | v0.3, approval in v0.6 |
| A5 | Publish at `<name>.potomac.solutions` | n/a | n/a | Project (`completed`) | v0.2 |
| A6 | Optional: hand over a zip of the site, or take on domain management | Email | Portal | Deliverable (v0.3). Domain management is a new Opportunity | v0.2 |
| A7 | Changes past the fourth round are billable at $50/hr or quoted | Email | Portal | New Opportunity | v0.2 |

### Path B: paid work

| # | Step | Until the portal | With the portal (v0.6) | Record touched | In HQ from |
| --- | --- | --- | --- | --- | --- |
| B1 | Estimate time and complexity against existing designs and frameworks | n/a | n/a | Opportunity (value) | v0.2 |
| B2 | Send the quote within two business days of the consult | Email or paper | Client reviews it in the portal | Opportunity (`quoted`). Proposal from v0.4 | v0.2 |
| B3 | Client accepts | Printed agreement, signed, then scanned | Typed acceptance in the portal, recording name, time and proposal version | Opportunity (`won`), Client Organization (`active`). Agreement from v0.4 | v0.2 |
| B4 | Client pays a deposit of one third of the quote | Cash or check, recorded by hand | Portal payment page, card through a gateway | Payment status from v0.5. A note on the Opportunity before that | v0.2 |
| B5 | Convert the opportunity to a project. Work starts only after the deposit | n/a | n/a | Project (`active`, linked to the Opportunity) | v0.2 |
| B6 | Build. Time is tracked by a timer that starts when the job is marked "working on" | n/a | Client views progress and billable hours | Project. Time Entry from v0.5 | v0.3, v0.5 |
| B7 | Client requests changes during the build | Email | Portal change requests | Project | v0.3 |
| B8 | Client signs off on the final version | Email or paper | Portal approval | Project, Activity Event | v0.3, approval in v0.6 |
| B9 | Client pays the balance in full | Cash or check | Portal payment page | Invoice and payment status from v0.5 | v0.5 |
| B10 | Launch. Happens only after sign-off and full payment | n/a | n/a | Project (`completed`) | v0.2 |

### After launch: clients on a monthly or yearly plan

| # | Step | Until the portal | With the portal (v0.6) | Record touched | In HQ from |
| --- | --- | --- | --- | --- | --- |
| C1 | Ongoing requests and changes, mostly asynchronous | Email | Portal messages | Project | v0.3 |
| C2 | A face-to-face call when needed | Agreed by phone or email | Booking tool | Follow-up date | v0.2 |
| C3 | Recurring billing, monthly or yearly | Cash or check, recorded by hand | Portal payment page | Invoice and payment status | v0.5 |

A recurring plan is one Project of kind `ongoing`. It never moves to
`completed`. It stays `active` until the client cancels, then moves to
`cancelled`. One-time work is a Project of kind `fixed`.

Every step that changes a record also writes an Activity Event.

## Open items

1. **Fair-use limit on "unlimited support and updates".** One demanding client
   on the $50/mo plan can cost more hours than the plan pays for.
2. **Multi-page website build fee.** Recorded as none.
3. ~~**Social media monthly volume.**~~ Decided 2026-11-25: 8 posts and 1
   blog post a month (decision 0011).
4. **Automations pricing.** Recorded as quoted per project.
5. **Where signed paper agreements are kept before v0.3**, when the file
   service ships.
6. **Card gateway.** Undecided, not needed before v0.6.
