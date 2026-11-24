# 0008. Agency tools: keys, GitHub, workload, imports and CRM habits

Status: decided 2026-11-24 at Mikey's request ("let's make the roadmap for
each and implement them"), after decision 0007 was finished and he asked
which other tools were worth importing from or borrowing ideas from,
naming Salesforce and Atlassian. Claude proposed the list below from Jira,
Jira Service Management, Salesforce, HubSpot, Productive, Teamwork and
Basecamp; Mikey took all of it. The open choices are marked **Default**:
Claude's pick, to be confirmed or changed in review. Built by Claude in the
order under "Slices", one pull request into `staging` each.

## Context

After decision 0007, HQ's tasks are close to a full task manager. What a
two-person web agency still does by hand, or in another tool, is:

- talking about a task out loud or in a commit, with no short name for it;
- connecting the code in the client sites' GitHub repositories to the work;
- seeing who is overloaded next week before promising a date;
- moving work in from tools other than Trello and Todoist, and clients and
  time from the CRM and timer someone used before;
- rules of habit ("when this, do that") that today need n8n;
- holding itself to a reply time on client requests;
- knowing what the pipeline is worth, stopping a proposal that gives too much
  away, and not adding the same client twice;
- a weekly "what did you work on" that doesn't need a meeting;
- keeping an eye on monthly plans across all clients at once.

HQ takes ideas from those tools, not their code or their size: nothing here
adds sprints, story points, custom fields or a second CRM.

## Decision

### 1. Task keys

Each project gets a short **key** of 2 to 5 capital letters, made from its
name when it's made ("Better Days website" is `BDW`; a key already used
gets a digit) and changeable on the project page. Its tasks are numbered
from 1 in the order they're made, so a task is `BDW-12`. To-dos, which have
no project, are `TODO-7`, numbered across HQ. Existing projects and tasks
get keys and numbers when the migration runs, in the order they were made.
A number is never reused; changing a project's key changes how its tasks
are written, and the old key keeps finding them.

Keys show on task pages, lists, the board, the work table and notices.
Search, quick add and the top bar find a task by its key: typing `BDW-12`
and pressing Enter opens it.

### 2. GitHub

A project's "repository" link (it exists since v0.6) says which GitHub
repository is its code. HQ takes GitHub's webhook for pushes and pull
requests at one address, checked with a secret shown once (the same
`X-Hub-Signature-256` HMAC GitHub sends). A commit or pull request whose
message or title names a task key (`BDW-12`) in a repository linked to that
task's project:

- shows on the task, under "Code": the commit or pull request, its title,
  who, when, and a link to GitHub;
- **Default:** a merged pull request that says `fixes BDW-12`, `closes` or
  `resolves` moves the task to done, recorded as done by GitHub. Merely
  mentioning it does nothing more.

Keys in other repositories are ignored. Setting it up needs `webhook.manage`
(admin), as webhooks do. Nothing is sent to GitHub.

### 3. Workload by week

Each person has a **capacity**: hours of project work in a week, **Default**
30, set by an admin on the People page (a person can see their own). A
task's estimate is spread evenly over the working days (Monday to Friday)
from its start to its due date, or all on its due date without a start;
tasks with no estimate or no due date, and done tasks, count nothing.

A **Workload** page shows each person, for this week and the next five, the
hours estimated against their capacity, marked over when it's more than
100%, with the tasks behind each week a click away. Unassigned work is a
row of its own. Needs `task.view`.

### 4. Tasks from any CSV

A third import source beside Trello and Todoist (decision 0007, section
13): any CSV, such as Asana's, ClickUp's, Monday's, Notion's, Jira's or a
spreadsheet's. After the upload, a step asks which column is the title (the
only one needed), and which, if any, are the description, status, due date,
start date, priority, labels, assignee (matched to HQ people by name or
email) and parent (for subtasks). HQ guesses the matches from the column
names and remembers the last ones used. Then the same preview, and the
same all-at-once import.

### 5. Retainers

A project on a monthly plan with an hours budget is a **retainer**. Its
budget already counts this month's time (v0.5). Now:

- a **Retainers** page lists every active one: this month's hours used
  against the allowance, last month's, and its trend, with a bar each;
- at 75% and at 100% of the month's hours, its owner gets a notice (once
  each a month);
- **Default:** unused hours don't carry over to the next month. (Carrying
  over is a contract term; HQ would need to record it per client.)

Needs `finance.view`, as budgets do.

### 6. Automation rules

An admin or manager (**Default:** new key `automation.manage`) writes rules
of the form **when** something happens, **if** it matches, **then** do
something:

- **When:** a task is added, moved to a status, given to someone, labelled,
  commented on, or becomes overdue (checked each morning).
- **If (all optional):** it's in a given project; it has a given label; its
  priority is at least a given one; it's a to-do or a project task.
- **Then (one or more):** give it to someone; put a label on it; set its
  priority; move it to a status; add a comment as "HQ"; send someone a
  notice.

Rules run in the same transaction as what started them, as the person who
did it. A rule's own changes don't start rules (no loops). Each rule shows
how many times it ran and when last, and can be paused. Every change a rule
makes is recorded as that rule's.

### 7. Reply targets

Client requests get a **reply target** in business hours (Monday to Friday,
9 to 5, in the business time zone): **Default** one business day for change
requests and call requests from the portal, and for new inquiries from the
website. A request still waiting shows how long is left, turns amber at the
last quarter and red when missed, on its own page, on Today and on the
dashboard. Answering stops the clock. The targets are set on a settings
page by an admin. Nothing is sent to the client.

### 8. Weighted forecast

Each open pipeline stage has a **likelihood**: **Default** new 10%,
consult booked 20%, consulted 40%, quoted 60%. An opportunity's value times
its stage's likelihood is its weighted value. The pipeline shows each
stage's total and weighted total, and a **Forecast** shows, for this
quarter and the next, the work expected to close (by the opportunity's
expected close date, a new optional field), weighted and unweighted. The
likelihoods are set by an admin. Needs `opportunity.view-value`.

### 9. Proposal approvals

A proposal needs another person's approval before it can be sent when its
total is over a set amount, or its discount (its total against its lines at
the usual rates) is over a set percent: **Default** over $5,000, or over
15% off. Asking sends a notice to everyone who may approve (new key
`proposal.approve`, **Default** admin). Approving or sending back, with a
note, is recorded; a proposal changed after approval needs it again. The
two limits are set by an admin.

### 10. Duplicate warnings

Adding a client or a contact checks for ones that look the same: a client
with the same name ignoring case, punctuation and words like "LLC", or the
same website's domain; a contact with the same email or phone (by the
same rules the portal uses). A match is shown with a link, and adding it
anyway takes a second click. Importing clients reports likely duplicates
in its preview. Nothing is merged automatically.

### 11. Check-ins

An admin or manager asks a question on a schedule, of chosen people:
**Default** "What did you work on this week?" on Fridays at 3. Each person
gets a notice; answers go on the check-in's page, newest first, one per
person per time asked, and can be commented on. A person can answer late;
an unanswered one shows as "No answer". Asked with `task.view`; set up with
`automation.manage`.

### 12. Clients from Salesforce and HubSpot

The client import (v1.0) reads the CSV exports of Salesforce accounts and
contacts and HubSpot companies and contacts, by their column names, besides
HQ's own: names, websites, phones and addresses, and each contact with its
company. Deals and opportunities are not imported. Duplicates (section 10)
are shown, not added.

### 13. Time from Toggl and Harvest

Time entries come in from Toggl Track's and Harvest's detailed CSV
exports: each row's project matched to an HQ project (asked, with guesses
by name), its person to an HQ person (by email, then name), its date, its
hours, and its description. A preview, then all at once, as a project's
time; entries already imported (the same person, day, hours and
description) are skipped. Needs `time.log` for one's own time and
`finance.edit` for others'.

## New permissions

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| Write and pause automation rules, and set up check-ins | `automation.manage` | Yes | Yes | No | No |
| Approve proposals over the limits | `proposal.approve` | Yes | No | No | No |

Everything else uses keys that exist: `webhook.manage` for GitHub,
`user.set-roles` for capacity, `finance.view` for retainers,
`opportunity.view-value` for the forecast, `client.create` and
`contact.edit` for duplicates, `time.log` and `finance.edit` for time.

## Slices

1. Task keys
2. GitHub
3. Workload by week
4. Tasks from any CSV
5. Retainers
6. Automation rules
7. Reply targets
8. Weighted forecast
9. Proposal approvals
10. Duplicate warnings
11. Check-ins
12. Clients from Salesforce and HubSpot
13. Time from Toggl and Harvest

## Consequences

- GitHub is the second thing (after the website's booking API) that sends
  HQ requests from outside without a person signed in. Its secret is shown
  once and checked on every request; anything unsigned is refused.
- Rules can change tasks without a person doing so directly. They act as
  the person whose action started them, under that person's permissions,
  and every change says which rule made it.
- Proposals over the limits can't be sent by one person alone. The limits
  are settings, not code, so they can be changed without a release.
