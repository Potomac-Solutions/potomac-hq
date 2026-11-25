# 0014. Undo, moving back, and clearer dragging

Status: decided 2026-11-25 at Mikey's request: "I want to be able to undo
changes if I mess up a click. Pipeline is a one way street but I want to be
able to move back to new if I mess up... undo would be nice everywhere...
being able to drag back would be nicer. Use more visual cues when dragging
too." Built on one branch, reviewed by Mikey before it merges into
`staging`.

## Context

The pipeline only moved forward. Won and lost were final ("a deal that comes
back is a new opportunity"), so a mis-click on a card or a mis-drop meant a
new opportunity or living with the wrong stage. Nothing in HQ could be
undone. Cards on the pipeline and the board were draggable, but only the
cursor said so, and only the column under the card lit up while dragging.

## Decision

### 1. Moving back

- A person may move an opportunity to any open stage: back to any earlier
  one, or forward again to put it back where it was. Forward by drag or
  button is still one stage at a time; skipping ahead is only for Undo.
- Won and lost can be reopened at an open stage. That clears the close date
  and the lost reason. Won is still reached only from the stage before it.
- A won deal that is already a project stays won.
- Each stage's needs still apply on the way back in: a service from
  consulted on, a price for quoted and won.
- Automatic moves (booking a call, sending or accepting a proposal, import)
  never go back or skip: the domain only allows it when the move says it was
  chosen by hand (`byHand`, the form's `back=1`).
- A client made active by a win stays active when the deal is reopened.
  Change the client's status by hand if it should go back.

### 2. Undo

- After a change that can be reversed, the page that comes back carries a
  signed `undo` beside its message: the form post that reverses it. The
  shell shows it as an Undo bar at the bottom of the screen, with Ctrl+Z or
  ⌘Z when the focus isn't in a field.
- Undo is an ordinary post through the same route, permission check and
  activity event as any other, so it is audited like everything else.
  Undoing an undo redoes it.
- The undo is signed with the notice secret, like the messages, so a link
  can't put a button on a page that posts something the server didn't offer.
- Undo is offered for: opportunity stages (pipeline and the opportunity's
  page), client status, project status, task moves on the board, and ticking
  off or reopening a to-do.
- It is not offered when the reverse isn't allowed: back into lost (that
  needs a reason), a project status that can't go back, or a repeating task
  whose next one was made when it was finished.
- Undo covers the last change only. There is no history to step through.

### 3. Dragging

- Draggable cards have a grip, lift on hover and show a grab cursor.
- The card being dragged fades to a dashed outline.
- While dragging, every column it can go to is outlined and shows "Drop to
  move here" (or "back here"); on the pipeline, columns it can't go to are
  dimmed and say "One stage at a time", and it can't be dropped there. The
  column under the card fills in.
- Each pipeline card has a Back button beside "Move to …" for keyboards and
  touch.

## Not in this decision

- Undo for edits to text (a client's details, a task's description) and for
  deletes. Those need the old values kept; worth a follow-up if mis-clicks
  there turn out to matter.
- Dragging on touch screens. Browsers don't send drag events for touch; the
  buttons and menus work there.
