# Pre-staging reconciliation, 2026-11-25

Before staging, every open pull request into it was merged together on a
`pre-staging` branch to find conflicts early. #168 (decision 0014) and #169
to #171 (decisions 0015 and 0016) had each built three of the same things,
in different ways. Mikey chose "best of each": keep whichever version covers
more, and move what the other did into it. This page records each overlap,
what was kept, and what was dropped, with where the dropped code still
lives. Everything a person could see or do in either version has since
been brought back (2026-11-25); only internals (an endpoint, a module and
its migration) are gone.

Merge order, and the migrations it gives with no gaps: #168 (0072), #169
(0073), #170 (0074), #171 (0075 to 0077), #166 (0078, 0079), #167 (0080),
#173 (0081). #169 now targets #168's branch.

## 1. Ctrl+K: #168's command palette and #170's command bar

**Kept: the command bar** (`src/shared/ui/parts/command-bar.zb`). It
already did page search, records, voice and asking the assistant.

Carried over from the palette, so the palette lost nothing:

| The palette did | Now |
| --- | --- |
| Moved a deal it found to its next stage or back one | The command bar does, from `/find.json`'s `moves`. The move is listed after pages and records, so Enter opens what was typed and never moves a deal (the palette listed it first) |
| "Quick add “…”" | In the command bar |
| "Search everything for “…”" | In the command bar |
| "Keyboard shortcuts" | Type "keys" in the command bar |
| `?` list of shortcuts, G then a letter | Unchanged, in `keyboard-shortcuts.zb` (G then D is now Home) |
| "Go to… Ctrl K" in the top bar | The command bar's own "Go to… /" button |
| `/` focused the search box | `/` opens the command bar, which has "Search everything" |

| With nothing typed, listed every page in the person's navigation | The command bar does too, by hub (brought back, 2026-11-25) |

Only `GET /palette.json` is gone, folded into `/find.json`; nothing a person
sees went with it.

Where the palette's code still is: `src/shared/ui/parts/command-palette.zb`
and `src/dashboard/api/palette-routes.ts` at commit `f4274e9`
(`feat/undo-and-drag-back`).

## 2. Undo: #168's Undo bar and #171's ten-minute Undo

**Kept: #168's Undo bar.** It covers everything #171's did (moving a task,
ticking off or putting back a to-do) and much more: saving details, deal
prices and follow-ups, client and project status, adding links, comments,
labels and filters, Ctrl+Z, Recent changes, and delayed sends and removals.

#171's `src/undo` module and its migration are gone. What only it did is
brought back into #168's (2026-11-25):

- **Undo after finishing a repeating task.** #171 offered it; #168 didn't,
  because the next one it made would be left behind. Now Undo is offered,
  and it takes that next one back too, with its copied subtasks and labels,
  if nothing has happened to it (`projects/infrastructure/repeat-taker.ts`
  reads "nothing" from the schema's foreign keys, plus files). If it has a
  comment, time, a file or the like, it stays, and the message says so;
  finishing this one again makes no second one. The same goes for ticking
  off a repeating to-do, which neither version handled.
- #171's Undo lasted ten minutes; #168's lasts a day and works once. The
  longer one covers the shorter, so nothing is lost. Both are only for the
  person who made the change.

Where #171's code still is: `src/undo/`, `migrations/0078-undo.sql`, and the
`?undo=` line in `src/app.zb`, at commit `eaeae6e`
(`feat/quality-of-life`).

## 3. Unsent text: #168's page keeper and #171's drafts

**Kept: #168's** (`page-keeper.zb`). Both kept a text box's words on the
device and brought them back after a reload. #168's also asks before
leaving a typed form and clears them on sign-out.

Brought back from #171's into #168's (2026-11-25): text is kept for 14
days, not 7, and it's let go only once a send works (the next page carries
the server's `done=` message). A send that never arrives, or is refused,
keeps it. #168 let it go as the form went.

Where #171's code still is: the "Text that survives a dropped signal" part
of `src/app.zb` at commit `eaeae6e`.

## 4. The sidebar

#169's eight hubs replace #168's sections. #168's new **Recent changes**
page is in the Today hub, and can be found by searching "undo".

## 5. Other conflicts, merged with nothing dropped

- `src/app.ts`: route wiring from every branch, all kept.
- The client page and the invoice page: #166's invoices on a client and
  #173's promises, pay links and write-offs, plus #171's "What changed here"
  and merging duplicates.
- `src/finance/api/finance-routes.ts`: #173's client-level recurring billing
  and prepaid hours, plus #171's marking several drafts sent.
- `CHANGELOG.md` and `theme.css`: every branch's lines kept.

Each of #166, #167 and #173 still conflicts with #171 in those files when
merged alone. `pre-staging` shows how they fit; whoever merges them second
can take its version of those lines.
