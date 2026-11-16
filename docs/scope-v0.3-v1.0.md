# Scope for v0.3 to v1.0

Status: decided 2026-11-16 while Mikey was away. Needs his approval.

On November 16 Mikey asked for the rest of the roadmap to be built without
stopping, until HQ is ready to deploy to Railway. The conventions say a
decision the roadmap and `docs/` do not cover is asked, not guessed. He was
not there to ask. So each open decision was settled with the smallest option
that meets the roadmap's line, and is written down here. Any of them can be
reversed. Nothing below has been used with real records yet, and the "week of
real use" between releases has not happened: the gates in the roadmap are
still open.

## v0.3 Projects

### Kept

| Roadmap line | Smallest version built |
| --- | --- |
| Project record | Owner, status, health (set by hand), start and target dates, a description |
| Phases and milestones | Phases in order. Milestones with an optional due date and phase. The next milestone is worked out, never stored |
| Tasks | Assignee, priority, due date, estimate in hours, four statuses. No dependencies |
| List view and board | A list per project, a board per project, and one board across every active project with "only mine". Drag and drop, with a form on each card that does the same without a mouse or JavaScript |
| Project history | Read from the audit table |
| Deliverables and the file service | Upload, type and size checks, authorized downloads, both recorded. Sharing with the client is a switch that v0.6 reads |
| Dashboard panels | Active projects, and deadlines in the next two weeks |

### Moved in from v0.2

- **Notes** on clients, opportunities and projects.
- **Drag and drop on the pipeline.** The buttons stay.
- **Dark mode** (issue #2): light, dark, or the device's setting, chosen per
  person in Settings.

### Decided here

- **Files are kept in the database** (decision 0002).
- **Every role holds the eight new permissions.** A member already does all
  client work except deal values.
- **A project's health is set by hand.** Working it out from overdue
  milestones would be a rule nobody has asked for.
- **Notes cannot be edited or deleted.**

### Cut

| Cut | Why | Lands |
| --- | --- | --- |
| Reordering phases and editing or deleting milestones and phases | Adding and completing is what the slice needs | When a real project needs it |
| Task comments | The project's notes hold the conversation | When a second person joins |
| Notes on contacts | A contact has no page of its own. A note on the client covers it | If contacts get pages |
| Search and sort on the lists | Still under a screenful | When a list passes a screenful |
