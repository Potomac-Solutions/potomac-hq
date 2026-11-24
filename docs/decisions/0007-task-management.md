# 0007. Task management, after Vikunja

Status: decided 2026-11-24 at Mikey's request ("the hq needs a little more
work. i want to be able to do more", with Vikunja as the model). He chose
all twelve features below from a list, and answered the open choices the
same day: who shares links, whether comments can change, what blocking
does, and the defaults for labels, saved filters, reminders and repeats.
Built by Claude in the order under "Slices", one pull request into
`staging` each.

## Context

HQ has two kinds of work item. A **task** belongs to a project: an
assignee, a priority, a due date, an estimate and four statuses, on a list
and a board, and moving it to "working on" starts the timer. A **to-do** is
a quick item with an optional day, optionally about a client. Neither has
labels, subtasks, repeats, reminders, comments or attachments, and there is
no way to see all work in one place, on a timeline, or from outside HQ.

Vikunja, an open-source task manager, has all of these. HQ takes the ideas,
not the code: everything is built in HQ's own layers, with domain rules
tested with nothing installed, a permission check and an activity event on
every service, and migrations for every schema change.

Dark mode, which came up at the same time, already exists (v0.3, Settings).

## Decision

### 1. One inbox: a to-do becomes a task without a project

`task.project_id` becomes optional, and a task gains `organization_id` and
`opportunity_id` (optional, as to-dos have now). A migration moves every
to-do into `task`, keeping its id, dates and who added it. The To-dos page
becomes **My work**: every open task assigned to you, from any project or
none, grouped as overdue, today, upcoming and someday. A task without a
project has no phase and no board column; it is `todo` or `done`.

The `todo.*` events stay readable in history; new ones are `task.*`.

### 2. Labels

A label is a name and one of twelve colours, each a light and dark pair
that passes contrast with its text. A task has any number. Labels are
shared by everyone. Anyone with `task.edit` applies them and makes a new
one. Renaming, recolouring and deleting one needs `label.manage`: admin
and manager.

### 3. Saved filters and the table

A filter is made of fields, not free text: projects, clients, assignees,
labels, statuses, priorities, a due range (overdue, this week, next week,
none, between two days) and words in the title. The **table** (`/work`)
shows every task you may see, any filter applied, sortable by any column,
with the columns you choose remembered per person, and downloads as CSV.

A filter can be saved with a name, and pinned to the sidebar. A saved
filter is yours alone unless you share it with everyone.

### 4. Quick add

One box, on every page (and the key `N`). The words in it set the fields
and are taken out of the title:

| Typed | Sets |
| --- | --- |
| `today`, `tomorrow`, `fri`, `next week`, `in 3 days`, `dec 5`, `12/5` | Due date |
| `*website` | Label (made if new, with `task.edit`) |
| `@jayanti` | Assignee |
| `!high`, `!urgent`, `!low` | Priority |
| `+better-days` | Project (or client, when no project matches) |
| `every week`, `every month`, `every 2 weeks` | Repeat (section 7) |

What it understood shows under the box before it is saved, and each part
can be removed with a click. Words it doesn't recognise stay in the title.

### 5. Subtasks and blocking

A task may have **subtasks**: tasks with a `parent_id`, one level deep, in
the same project. The parent shows "3 of 5 done". Finishing the parent
doesn't finish its subtasks.

A task may be **blocked by** another, in any project. The blocked task
shows what it is waiting on, and the blocker shows what it holds up. Moving
a blocked task to "working on" is allowed, with a warning. A task can't block itself or, through others, its own blocker.

### 6. Comments and attachments

Each task has comments, written by people with `task.view`. Unlike notes,
the author may edit or delete their own comment: an edited comment says so,
and the task's history keeps every version and the deletion. `@name` in a
comment tells that person (section 8). Files attach to a task as they do to
a deliverable, with the same type checks and download rules.

### 7. Repeating tasks

A task may repeat every N days, weeks, months or years, counted either from
its due date or from the day it was done. Finishing it makes the next one:
a new task with the next due date, the same title, description, labels,
assignee, priority, estimate and subtasks (not done), and a link to the
one before. The finished one keeps its time and comments.

### 8. Reminders and notices

A task may have reminders, at a time or a set time before it is due. A
reminder, an assignment and an `@mention` each make a **notice**: a bell in
the header with what's new, also listed on Today. When outbound email is
set up (Brevo), a person can also have their notices emailed; until then
they're in HQ only. Browser push is not part of this.

### 9. The timeline

Tasks gain an optional `start_on`. A project's **Timeline** shows its
phases, milestones and tasks as bars from start to due (a task with only a
due date is a point), with today marked. A second timeline shows every
active project. It is drawn on the server and needs no script; dragging a
bar to change its dates is not part of this.

### 10. The calendar feed

Each person has a private calendar address (`.ics`) that Google Calendar,
Apple Calendar or Outlook can subscribe to: their tasks with due dates and
the milestones of projects they're on, read-only. It can be made from a
saved filter instead. Making a new address stops the old one. Changes in
the calendar don't come back to HQ.

### 11. Sharing a project by link

A project can be shared by a link that needs no account, until it is
stopped or its expiry date passes. Each link has its own rights: **see**
(phases, milestones, tasks and their status and due dates, and shared
deliverables) or **see and comment** (comments show the name the visitor
typed and are marked as from the link). It never shows internal notes,
time, estimates, money or other projects. Every visit is logged. Making and
stopping links needs `project.share`: admin and manager. When the client portal arrives, the portal is the better home
for this; links stay for people without an account.

### 12. Webhooks for n8n

An admin adds a web address and picks the events to send (task added,
moved, done, commented on, assigned; project added and completed). Each
delivery is signed (HMAC-SHA256 with a secret shown once) and retried with
a growing wait for a day; the last 200 deliveries and their answers are
listed. Needs `webhook.manage`: admin only.

### 13. Import from Trello and Todoist

From a Trello board's JSON export or Todoist's CSV export, into a project
you choose: lists become statuses (by name, or "to do"), cards and items
become tasks, labels carry over, checklists become subtasks, due dates come
across. A preview shows what will be made before anything is. Needs
`task.edit` and `project.edit`.

## New permissions

| Action | Permission key | Admin | Manager | Member | Client user |
| --- | --- | --- | --- | --- | --- |
| Rename, recolour and delete labels | `label.manage` | Yes | Yes | No | No |
| Make and stop share links | `project.share` | Yes | Yes | No | No |
| Add and change webhooks | `webhook.manage` | Yes | No | No | No |

Everything else uses `task.view` and `task.edit`. A share link is not a
user: it sees only what its rights say, and only that project.

## Slices

Each is one pull request into `staging`, with its migration, permissions,
events, tests and changelog line. The order puts the pieces the others
build on first.

1. Labels
2. One inbox (to-dos become tasks; My work)
3. Filters, saved filters and the table
4. Quick add
5. Subtasks and blocking
6. Comments and attachments
7. Repeating tasks
8. Reminders and notices
9. The timeline
10. The calendar feed
11. Sharing a project by link
12. Webhooks
13. Import from Trello and Todoist

## Consequences

- To-dos stop being a separate thing. Anything that read the `todo` table
  (Today, the dashboard, the morning email) reads tasks without a project.
- The authorization matrix and the data model gain the fields and
  permissions above, in the slice that adds each.
- Webhooks and the calendar feed are the first things HQ sends out or
  serves without a signed-in person. Both carry secrets that are shown
  once, stored hashed, and can be replaced.
