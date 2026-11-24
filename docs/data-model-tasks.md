# Data model: task management

Decision 0007 (`docs/decisions/0007-task-management.md`), after Vikunja. To-dos
becoming tasks without a project is under "To-dos" in
[data-model-after-1.0.md](data-model-after-1.0.md).

## Label

Added by decision 0007, section 2.

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `name` | text | Required, at most 40 characters. Inner runs of spaces become one |
| `name_key` | text | The name in lower case. Unique: "Website" and "website" are one label |
| `colour` | `slate`, `red`, `orange`, `amber`, `green`, `teal`, `sky`, `blue`, `indigo`, `violet`, `pink`, `brown` | Picked from the name when none is chosen |

`task_label` joins a task to each of its labels. Deleting a label takes it
off every task. Events: `label.added`, `label.edited` (with the old name),
`label.removed` (with how many tasks had it), and `task.labelled` (the names
put on and taken off).

## Saved filter and work view

Added by decision 0007, section 3. The work table (`/work`) reads every task
of an active project and every to-do; a filter is the page's address, made
only of fields (projects or "none" for to-dos, clients, people or "me" and
"nobody", labels, statuses, priorities, due windows, a due range, words in
the title, and open, finished or both). Within a field any choice matches;
across fields every field must. Weeks run Monday to Sunday.

`saved_filter`:

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `owner_id` | User id | Who saved it. Only they pin, share or delete it |
| `name` | text | Required, at most 60 characters |
| `query` | text | The filter's address, read and written again so only filter fields are kept. Never empty |
| `shared` | yes or no | Everyone sees it on the work page. Starts no |
| `pinned` | yes or no | On its owner's sidebar. Starts no |

`work_view` keeps each person's chosen columns (`user_id`, `columns`). No
row means the default: project, who, status, priority, due and labels.
Events: `filter.saved`, `filter.changed`, `filter.removed`,
`work.columns-chosen`.

## Quick add

Added by decision 0007, section 4. No table of its own: a line typed at
`/add` (or in the top bar's box, or after pressing N) becomes a row in
`task`, with `created_by` set to whoever added it. `+handle` names an open
project, which makes a project task, or else a client, which makes a to-do
with `organization_id` set. A to-do with no `@person` is the adder's; a
project task with none is no one's, as on the project page. New `*labels`
are made on the way. Events are the usual ones (`task.added` or
`todo.added`, with `quick: true`, then `label.added` and `task.labelled`).

## Subtasks and blocking

Added by decision 0007, section 5 (migration 0043).

`task.parent_id` points at the task a subtask belongs to. Subtasks go one
level deep, under project tasks only (to-dos have no project to share), and
are made in their parent's project and phase. A parent shows "3 of 5 done";
finishing it doesn't finish its subtasks.

`task_block` says one task waits on another:

| Field | Type | Rule |
| --- | --- | --- |
| `blocked_id` | Task id | The task that waits |
| `blocker_id` | Task id | What it waits on, in any project or none. Never the same task |
| `created_by` | User id | Who said so |

No circles: a task can't wait on anything that already waits on it, however
far back. Waiting never stops a move; moving a waiting task to "working on"
says what it still waits on. This is separate from the "Blocked" status,
which is still set by hand. Events: `task.added` (with `parentId`),
`task.blocked`, `task.unblocked`.

## Task comments and files

Added by decision 0007, section 6 (migration 0044).

`task_comment`:

| Field | Type | Rule |
| --- | --- | --- |
| `id` | id | |
| `task_id` | Task id | |
| `author_id` | User id | Only they edit or delete it; no role overrides that |
| `body` | text | 1 to 5,000 characters |
| `edited_at` | time | When it was last edited, shown as "(edited …)" |

Deleting a comment removes its row. Every version and the deletion stay in
the task's history as events: `comment.added` (with `body` and the people it
`mentions`), `comment.edited` (with `was`, `body`, and anyone newly
mentioned) and `comment.removed` (with `was`). A mention is `@` and a first
name, a full name with hyphens, or the name part of an email, meaning one
active person; telling them comes with notices (section 8).

Files attached to a task are rows in `file` with `owner_type` `task`, filed
under the project's client or a to-do's own, with the same type checks as a
deliverable. Downloading goes through `/files/:id` and `file.download`.
Events: `task.file-attached`, besides the files module's `file.uploaded`.
A task's file can be removed from that task, which deletes its bytes and its
record (`task.file-removed` and `file.removed`, which keeps the name, size and
hash). Only files whose owner is that task: a deliverable's or a receipt's
file can't be removed this way.

## Repeating tasks

Added by decision 0007, section 7 (migration 0045). Four columns on `task`:

| Field | Type | Rule |
| --- | --- | --- |
| `repeat_every` | 1 to 365 | With the next two: all set, or none |
| `repeat_unit` | `day`, `week`, `month`, `year` | |
| `repeat_from` | `due`, `done` | Counted from the due date, or from the day it was done |
| `previous_id` | Task id | The task whose finishing made this one. At most one task per previous |

Finishing a repeating task, from the board, its page or My work, makes the
next: the same title, details, person, priority, estimate, phase, labels,
client (for a to-do) and subtasks (not done, with their dates moved as far
as their parent's), due on the next date. Counted from the due date, that is
the first one after the day it was done; with no due date, it counts from
the day it was done. Months keep their day where they can. Finishing it again
after reopening makes no second one, and nothing is made for a task on a
project that isn't active. Subtasks don't repeat on their own. To-dos can.
Events: `task.repeat-set`, `task.repeat-stopped`, `task.repeated`.

## Notices and reminders

Added by decision 0007, section 8 (migration 0046), in the `notices` module.

`notice` is something new for one person: `assigned` (a task or to-do given
to them by someone else, when added or reassigned), `mentioned` (an
`@mention` in a comment, new or edited in) or `reminder`. Assignments and
mentions are made from the events the projects and todos modules record, in
the same transaction, by the activity log they're given; no one is told
about their own actions, and a repeat's next task isn't news. A notice has
`read_at`, set when it's opened or all are marked read, and `emailed_at`.

`task_reminder` is a reminder on a task: either at a time (`at`, fired
once), or `days_before` its due date (0 to 30) at a `time_of_day` in the
business time zone, which fires again for a new due date. `for_whom` is `me`
(its setter, and only they see it) or `assignee` (whoever has the task when
it fires, or its setter if no one does; everyone who sees the task sees it,
and anyone with `task.edit` may remove it). With `carry`, finishing a
repeating task copies it to the next one: one before the due date as it is,
one at a time moved as many days as the due date moved (in the business
time zone). Nothing fires for a task that's done. A job fires them every
minute.

`notice_setting` holds whether a person has their notices emailed (off until
they turn it on; turning it on covers what comes from then, not what's
already there). When email is set up, a job emails each of them their new,
unread notices every minute, one email per person, each notice once.

Events: `reminder.added`, `reminder.removed`, `reminder.fired`,
`user.notice-email-on`, `user.notice-email-off`. `task.edited` now also
records `assigneeWas`, and `task.repeated` records `previousDueOn`.

## The timeline

Added by decision 0007, section 9 (migration 0047). `task.start_on` is the
day work starts, optional and never after `due_on`. An edit that doesn't send
a start date keeps the one the task had; the task form sends it, so it can be
cleared there. A repeat moves it with the due date.

Nothing else is stored. A project's timeline (`/projects/:id/timeline`)
draws the project from its start to its target date, then a group per phase
(its span is its tasks' and milestones'), with tasks as bars from start to
due, or points with only a due date, and milestones as points. Every active
project's timeline (`/timeline`) draws each from its start to its target
date, or across its tasks' and milestones' dates when those aren't set, with
its milestones marked; demo clients' are left out. Both are drawn by the
server, with today marked; things with no dates are counted, not drawn.

## Calendar feeds

Added by decision 0007, section 10 (migration 0048). `calendar_feed` holds
each person's one calendar address: the SHA-256 `token_hash` of its 32-byte
secret (the address is shown once, on the answer to making it, and never
stored), an optional saved `filter_id` it follows (set back to none if the
filter is deleted), and when a calendar `last_used_at` it. Making a new one
replaces the row, so the old address stops; stopping deletes it.

The feed (`/calendar/<secret>.ics`) is served with no one signed in, and only
while its person is active and may see projects and tasks. It holds all-day
events: their open tasks with a due date (from the start date when there is
one) and the open milestones of active projects they own or have a task on;
or, following a filter, the tasks that filter finds for them. Calendars are
asked to check back hourly. Nothing comes back from a calendar. Events:
`calendar.feed-made`, `calendar.feed-stopped`.

