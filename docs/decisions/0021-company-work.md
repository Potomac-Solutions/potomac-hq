# 0021. Company projects and the company board

Status: decided 2026-11-27 at Mikey's request; expenses added the same day. He asked for one shared board
where he and Jayanti see every task in the company, and can give each other
tasks: for example, Jayanti's cloud and networking certificates (Cisco,
AWS, Google Cloud, Azure) and his own commerce and CMS certificates
(Shopify, Magento, BigCommerce, WooCommerce, WordPress). He chose the
proper fix over a stand-in client: **a project may be Potomac's own work,
with no client**, and **to-dos have a place on the board**. The choices he
didn't make are marked **Default**: Claude's pick, to be confirmed or
changed in review.

## What was missing

- The Board (`/board`) already showed every active project's tasks, with
  *Show only mine*, and any task or to-do could be assigned to anyone,
  with a notice. But every project belonged to a client and came from a
  won opportunity, so work that is Potomac's own had nowhere to live but a
  fake client.
- To-dos (tasks with no project, decision 0007) were in My work and the
  work table, but not on the Board.

## Decision

### 1. Company projects

- A project's `organization_id` and `opportunity_id` may both be empty. A
  client project has both; a **company project** has neither. Migration
  0089 rebuilds the `project` table to allow it, keeping every row, with a
  check that the two are empty together.
- **Started** from the Projects page, *Start a company project*: a name, a
  kind (has an end, or ongoing) and an owner (whoever starts it, unless
  they pick someone), and an optional description. It starts active and
  on track. Event: `project.created`, with `company: true`.
- **Who:** a new permission, `project.start`, for admins and managers.
  **Default:** members work in company projects like any other but don't
  start them: a company project spends the company's own time with no
  client paying for it, so starting one stays with those who set
  priorities.
- **Worked like any project:** phases, milestones, tasks, subtasks,
  labels, its own board and timeline, links, notes, share links and the
  work table all work as they do.
- **Shown as "Company work"** where a client's name would be: the
  projects list, the dashboard, reports, search, time and expenses.
- **Never billed.** An invoice or a recurring invoice on one is refused
  (`company-project`), and no deposit is ever drafted.
- **Its costs are business expenses.** Mikey asked (2026-11-27) that what
  company work costs, like certification exams and courses, be tracked as
  business expenses. The project's Money tab stays, with its expenses,
  time, budget and hours by phase, but without payment status, change
  requests, invoices, recurring invoices or margin. Two expense categories
  are added for any project (migration 0090): **Training and
  certifications** (`training`) and **Licenses, permits and filing fees**
  (`licenses`, like forming the LLC). Company expenses are in the expense
  lists and the tax pack, under "Company work".
- **Its time isn't billable.** A timer started by moving one of its tasks
  to *Working on*, or time logged by hand, is saved as not billable.
- **Nothing client-facing.** No deliverables, no updates for the client,
  no files from the client, no rating, no AI client update or case study,
  and a milestone can't be made "the client's to do" (`company-project`).
  No client user can see one, since it belongs to no client.
- **Default:** a company project counts as real work in the weekly owner
  email (at-risk projects, money out), like a client's that isn't a demo.

### 2. The company board

- The Board shows **every active project's tasks, company projects
  included, and everyone's to-dos**. A project's own board stays that
  project's tasks only.
- A to-do's card says *To-do* where a task's says its project.
- **A to-do still moves only between To do and Done**, as decision 0007
  set. Its menu offers only those two; dragging it lights only those two
  columns; the server refuses the rest with *A to-do is to do or done. Put
  it in a project to mark it working on or blocked.* (`todo-has-no-board`).
  **Default:** to-dos don't gain *Working on* and *Blocked*, because a
  to-do keeps no time, and *Working on* is what starts a timer.
- Finished to-dos stay in Done for two weeks, like finished tasks.
- *Show only mine* shows the tasks and to-dos assigned to you.

### Giving each other work

Nothing new was needed: a task's or a to-do's assignee is anyone active in
HQ, and assigning someone sends them a notice (decision 0007). Jayanti
needs her own HQ account for this; an admin invites her from People.

## Not done

- **A to-do moved into a project.** Today it would be added again as a
  task.
- **A person filter on the board** beyond *Show only mine*. The work table
  (`/work`) already filters by any person, and saved filters keep that.
