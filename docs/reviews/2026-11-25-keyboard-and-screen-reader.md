# Keyboard and screen reader pass, 2026-11-25

Status: **automated only.** This pass was done by browser tests and by
reading the markup. Nobody has yet used HQ from start to finish with a
screen reader (NVDA, VoiceOver or TalkBack) or by keyboard alone, so the
v1.0 gate in `accessibility-v1.0.md` stays open. This page says what was
checked, what was fixed, and what still needs a person.

## Checked by tests (`test/e2e/keyboard.test.ts`)

- The first Tab on a page reaches **Skip to content**, and Enter moves
  focus to the page's `main`.
- `/` opens the command bar with focus in its search box. Tab and
  Shift+Tab stay inside it. Escape closes it from anywhere inside, and focus
  goes back to what opened it.
- The **Undo** line after moving a task is a live region (`role=status`),
  is reached by keyboard and works with Enter.
- A brought-back draft says so in a live region, and the text is back in
  its box.
- The duplicate question, its "add it anyway" checkbox (Space ticks it),
  and the merge form (a `<details>` opened with Enter, a labelled select)
  pass axe, light and dark.
- Every new screen this round (Saved replies, the portal timeline, the
  Undo line, the merge form) passes axe with the WCAG 2.1 A and AA rules,
  as every screen does on each merge.

## Fixed in this pass

- The command bar didn't keep focus inside while open, only closed on
  Escape when focus was in its search box, and left focus at the top of the
  page when it closed. It now behaves as a modal dialog should.
- The command bar's search box sometimes wasn't focused when opened, when
  the page drew it a frame late.

## Still needs a person

- Hearing the whole of a day in HQ with a screen reader: the sidebar hubs
  (`<details>`), the assistant's drawer and its confirm cards, the board.
- Whether the Undo line and the brought-back message are read at the right
  moment, and not too often, in each screen reader.
- The assistant's drawer is a complementary region, not a dialog: whether
  that reads well, or whether it should trap focus too.
- The portal timeline with VoiceOver on an iPhone, which is how most
  clients will see it.
- Zoom to 200% and 400% on a phone and a laptop.
