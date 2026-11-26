# Pre-staging reconciliation, 2026-11-25

Before staging, every open pull request into it was merged together on a
`pre-staging` branch to find conflicts early. #168 (decision 0014) and #169
to #171 (decisions 0015 and 0016) had each built three of the same things,
in different ways. Mikey chose "best of each": keep whichever version covers
more, and move what the other did into it. This page records each overlap,
what was kept, and what was dropped, with where the dropped code still
lives, so anything can be brought back.

Merge order, and the migrations it gives with no gaps: #168 (0072), #169
(0073), #170 (0074), #171 (0075 to 0077), #166 (0078, 0079), #167 (0080),
#173 (0081). #169 now targets #168's branch.

## 1. Ctrl+K: #168's command palette and #170's command bar

**Kept: the command bar** (`src/shared/ui/parts/command-bar.zb`). It
already did page search, records, voice and asking the assistant.

Carried over from the palette, so the palette lost nothing:

| The palette did | Now |
| --- | --- |
| Moved a deal it found to its next stage or back one | The command bar does, from `/find.json`'s `moves` |
| "Quick add “…”" | In the command bar |
| "Search everything for “…”" | In the command bar |
| "Keyboard shortcuts" | Type "keys" in the command bar |
| `?` list of shortcuts, G then a letter | Unchanged, in `keyboard-shortcuts.zb` (G then D is now Home) |
| "Go to… Ctrl K" in the top bar | The command bar's own "Go to… /" button |
| `/` focused the search box | `/` opens the command bar, which has "Search everything" |

**Dropped, not brought back yet:**

- With nothing typed, the palette listed every page in the person's
  navigation (up to 30). The command bar shows a hint instead; the sidebar's
  hubs list the same pages.
- `GET /palette.json`, folded into `/find.json`.

Where the palette's code still is: `src/shared/ui/parts/command-palette.zb`
and `src/dashboard/api/palette-routes.ts` at commit `f4274e9`
(`feat/undo-and-drag-back`).

## 2. Undo: #168's Undo bar and #171's ten-minute Undo

**Kept: #168's Undo bar.** It covers everything #171's did (moving a task,
ticking off or putting back a to-do) and much more: saving details, deal
prices and follow-ups, client and project status, adding links, comments,
labels and filters, Ctrl+Z, Recent changes, and delayed sends and removals.

**Dropped, with #171's `src/undo` module and its migration:**

- #171 offered Undo after moving a repeating task to Done. #168 deliberately
  doesn't, because the next one it made would be left behind.
- #171's Undo lasted ten minutes; #168's lasts a day and works once. Both
  are only for the person who made the change.

Where #171's code still is: `src/undo/`, `migrations/0078-undo.sql`, and the
`?undo=` line in `src/app.zb`, at commit `eaeae6e`
(`feat/quality-of-life`).

## 3. Unsent text: #168's page keeper and #171's drafts

**Kept: #168's** (`page-keeper.zb`). Both kept a text box's words on the
device and brought them back after a reload. #168's also asks before
leaving a typed form and clears them on sign-out.

**Dropped:** #171 kept text for 14 days; #168 keeps it for 7. #171 let a
draft go only when the page after sending said nothing was wrong; #168
lets it go when the form is sent.

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
