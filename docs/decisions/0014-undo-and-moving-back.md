# 0014. Undo, moving back, clearer dragging, and keyboard and touch

Status: decided 2026-11-25 at Mikey's request: "I want to be able to undo
changes if I mess up a click. Pipeline is a one way street but I want to be
able to move back to new if I mess up... undo would be nice everywhere...
being able to drag back would be nicer. Use more visual cues when dragging
too." Built on one branch, reviewed by Mikey before it merges into
`staging`. Sections 4 to 7 were added the same day, when Mikey asked for
all eleven follow-ups Claude proposed ("all of these in the same branch").
Sections 8 and 9 followed: "make sure it's intuitive and allows mistakes to
be reverted... improve this tooling further yet." Section 10 came from "any
more improvements, now is the chance to do it".

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
- Also for edits: a task's details, a project's details, an opportunity's
  price (once it had one) and its follow-up date. Undo posts the old values
  back through the same edit form.
- Reopening a lost deal can be undone: the reason it had goes back with it.
- It is not offered when the reverse isn't allowed: a project status that
  can't go back, or a repeating task whose next one was made when it was
  finished.
- Undo covers the last change only. There is no history to step through.
- The post is kept in the database (`undo_stash`, migration 0072) and the
  page's address carries only a random token, so old values of any length
  fit: a task's description, a lost reason. A token works once, for a day,
  and `/undo/<token>` runs the kept post as if the browser had sent it.

### 3. Dragging

- Draggable cards have a grip, lift on hover and show a grab cursor.
- The card being dragged fades to a dashed outline.
- While dragging, every column it can go to is outlined and shows "Drop to
  move here" (or "back here"); on the pipeline, columns it can't go to are
  dimmed and say "One stage at a time", and it can't be dropped there. The
  column under the card fills in.
- Each pipeline card has a Back button beside "Move to …" for keyboards and
  touch.

### 4. Removing waits for Undo

- Any Remove or Archive button (except under Settings, such as a passkey)
  hides the item at once and shows "Removed. Undo" for six seconds. Only
  then is the removal sent, as the form would have sent it, so the page
  says what happened. Undo, or Ctrl+Z, puts it back and nothing is sent.
- Leaving the page, or removing something else, sends a waiting removal
  straight away in the background.
- This is done in the browser for every removal at once, so no module's
  removal had to change. Without JavaScript a removal is immediate, as
  before.

### 5. Keeping your place

- After a form post that comes back to the same page, the scroll position
  comes back, and focus returns to the moved card or the button that was
  pressed.
- Where the browser supports cross-page view transitions, cards that moved
  slide to their new place instead of the page flashing. Other pages change
  as before. Honours reduced motion.
- A form can't be sent twice: a second press while it's on its way does
  nothing, and the button shows it's busy.
- Leaving a page with a form you've typed in and not sent asks first.
- Green "done" messages fade after six seconds (not while the pointer or
  focus is on them). Problems stay.

### 6. Keyboard

- **Ctrl+K** (⌘K), or "Go to…" in the top bar, opens the command palette:
  HQ's pages, everything search finds, and for an opportunity it finds the
  move on to its next stage or back one, posted as the page's own form.
  Quick add and search are in it too. It reads `/palette.json`, which only
  answers what search and the opportunity page already would.
  **Later:** the palette became decision 0015's command bar, which kept
  the deal moves; `/palette.json` was folded into `/find.json`.
- **?** lists every shortcut. **G** then a letter goes to a page (T Today,
  W My work, D Dashboard, P Pipeline, C Clients, J Projects, B Board,
  M Money), if it's in that person's navigation. **/** goes to search.
- A pipeline or board card can be focused and moved: Space picks it up,
  ← and → choose a column (on the pipeline, only where it may go), Space
  drops it, Escape puts it back. A screen reader hears each step.

### 7. Touch

- A card's grip is a handle for a finger: drag it and the card follows,
  the column under it lights up, and the page scrolls near the edges.
  Mouse dragging is unchanged.

### 8. Recent changes, and undo that is yours alone

- **Recent changes** (`/history`, in the sidebar, the palette and G then H)
  lists the changes you made in the last day that can still be undone,
  newest first, each named ("Menu website: moved to consulted", "Order the
  sign: details saved") with its own Undo. It shows one per thing changed:
  undoing an older change to the same thing would put back something a
  newer change already replaced, so only the newest is offered.
- An undo belongs to the person whose page first shows it. Only they can
  use it, and only their changes are listed. Someone else's token isn't
  offered and is refused.
- The Undo bar names the change it puts back, instead of repeating the
  page's message, and links to Recent changes.
- A client's demo flag can be undone too.

### 9. Undo send

- Sending, publishing, sharing or voiding something that leaves HQ waits
  eight seconds, with "Sending…" (or "Publishing…", "Sharing…",
  "Voiding…", "Cancelling the call…") and Undo, before the post goes. That
  covers invoices, proposals, change requests, monthly reports, the
  newsletter, AI drafts, deliverables, reviews, sites and booked calls.
  Undo or Ctrl+Z says "Not sent." and nothing is posted.
- As with removals, leaving the page sends it straight away, it is done in
  the browser for every such button at once, and without JavaScript it is
  immediate. Settings and the client portal are left alone.

### 10. Adding can be undone; asking first; never losing typed text

- Adding something that has a Remove can be undone, which removes it: a
  project link, a task comment, a label, a saved filter, logged time, an
  expense, a demo, a referral link. Editing a comment can be undone too.
- The few things that can't be undone or held ask first, in a dialog with
  Cancel focused: turning off two-step sign-in, removing a passkey, making
  new recovery codes, resetting someone's two-step sign-in, turning an
  account off, and making a new webhook or automation secret. Without
  JavaScript they go at once, as before.
- Text typed in a long box (a comment, a description, a note) and not sent
  is kept on that device while it's typed. If the page is closed, reloaded
  or crashes first, the text comes back next time with "Brought back text
  you hadn't sent", and Discard. It's cleared when the form is sent, after
  a week, and from every box when you sign out.
- Ctrl+Enter (⌘Enter) sends the form you're typing in.
- A card dropped on the pipeline or the board moves to its column at once
  while the server makes the move; the page that comes back has the final
  say, so a refused move puts it back where it was.
- Every page has room at the bottom, so the Undo bars never cover the last
  buttons.

## Not in this decision

- Undo for edits not listed in sections 2 and 8. (Clients and contacts have
  no edit forms yet; when they do, their saves should offer Undo.)
- Undoing a change after it was sent or published. Section 9 holds those
  before they go instead.
- Moving cards without the page reloading at all. HQ's pages are made on
  the server; section 5 makes the reload keep your place and animate
  instead.
