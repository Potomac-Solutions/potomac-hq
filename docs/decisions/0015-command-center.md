# 0015. Command center: hubs, a feature finder, setup, and an assistant

Status: decided 2026-11-25 at Mikey's request: "All of the features inside
the HQ are a bit loosely scattered and hard to find... I want to keep all of
the features but I don't want to have to search for them... perhaps an
initial chat window... where you can just have a quick chat with AI about
what needs to happen and it has full reign to do the tasks at hand within
the app." He answered Claude's three questions the same day, marked
**Confirmed**. Choices he didn't make are marked **Default**: Claude's pick,
to be confirmed or changed in review.

(0014 is held by an open pull request, so this takes 0015.)

## Context

By 0.17.0 the sidebar holds about 35 links in five groups, growing with
every decision. Every feature works, but finding one means scanning the
whole list, and the search box finds records, not pages. Nothing tells a
new user (or Mikey, after a week away) what still has to be set up.

## Decision

### 1. Hubs

The sidebar becomes **eight hubs**, in the order of a job:

| Hub | Holds |
| --- | --- |
| Home | The assistant and the dashboard (`/`) |
| Today | Today, My work, AI drafts |
| Clients | Pipeline, Clients, Proposals, Calls, Monthly reports |
| Work | Projects, Board, Timeline, All work, pinned filters, Labels, Time |
| Sites | Sites, Site content, Site builder, Landing pages, Automations, Renewals |
| Money | Money, Reports |
| Growth | Newsletter, Social media, Marketing, Referral links, Reviews, Demos, Our website |
| Company | Knowledge, Ask HQ, People, Audit history, Webhooks, AI model and budget (Settings stays in the top bar) |

The hub you're in is open; the others are folded to one line each and open
with a tap. Nothing is removed: every page keeps its address, and a hub
shows only the pages its viewer may open, as the sidebar does today.

One list in code (`places`) names every page once: its hub, its address,
the words people use for it, and who may open it. The sidebar, search and
the assistant all read it, so a new page is added in one place.

### 2. Search finds pages too

The top bar's search shows **Pages** above records: typing "booking",
"availability" or "invoice reminders" offers the page that does it.
"Go to" in the assistant uses the same list.

### 3. Setup checklist

Home shows **Get HQ ready** until everything on it is done: backups, email,
how clients reach Potomac, two-factor sign-in, the AI key, calendar hours,
importing clients and inviting Jayanti. Each line says why it matters and
links to where it's done (or to `docs/operations.md` for server
settings). Each is worked out from HQ's real state, never ticked by hand.
**Default:** shown to admins only; folded once three-quarters are done.

### 4. The assistant

Home opens on a box: **What needs to happen?** Type it in plain words.

- **It acts as you.** Every change goes through the same services the
  buttons use, so it can't do anything your role can't, and each change
  lands in Audit history as yours, marked as done through the assistant.
- **It reads freely**: records, pages, the knowledge base, what's waiting.
- **Confirmed:** every change shows a card first (**Do it / Cancel**) and
  happens on one tap. This keeps decision 0012's rule that AI only drafts
  and a person acts.
- **Confirmed:** a setting, **Let small changes go through without
  asking**, lets small internal changes happen right away, each with
  **Undo** for a day. **Default:** "small" means a change with an exact
  undo: moving a task, ticking off or reopening a to-do. Adding a task or
  to-do asks, because HQ has no way to take one back out. Anything with
  money in it, anything a client sees, and anything that can't be undone
  always asks. **Default:** off, set per person.
- **Confirmed:** it shares the one monthly AI budget with the drafts and
  the site builder, and is a feature switched on in Settings → AI like the
  others. It uses the usual model unless a model is picked beside the box,
  up to the ceiling (#165).
- **Default:** one running conversation per person, the last 20 messages
  sent each time; **New chat** starts over and cancels cards still
  waiting. Conversations are kept 90 days, then removed by
  `npm run retention`.
- **Default:** at most 4 lookups per message before it answers, so a
  message can't spend more than a few cents.

What it can do at first (**Default**, more as they're asked for):

| Kind | Actions |
| --- | --- |
| Look (no card) | Find records and pages; what's waiting today; search the knowledge base |
| Small (card, or straight through with the setting) | Move a task; tick off or reopen a to-do |
| Always asks | Quick add a task or to-do in quick add's own words; add a note; log a call or message; add a client; open a deal |
| Anything else | A link to the page that does it, filled in where the page allows |

## Follow-up (2026-11-25)

Mikey asked for all seven of Claude's follow-up ideas ("do them all"), on a
branch stacked on the first:

5. **Command bar.** `/` or Ctrl+K (⌘K) from any page, or **Go to…** in the
   top bar: pages and records as you type (`GET /find.json`, the person's
   own permissions), Enter opens one; with nothing picked, Enter asks the
   assistant from that page.
6. **The assistant on every page.** **Ask** in the top bar opens a drawer
   with the same conversation. A message is sent with the page's address,
   so "this" means that page's record. Open and close are links
   (`?chat=open`), so it works without scripts.
7. **Phones.** Under 60rem a tab bar along the bottom: Home, Today, Search,
   Add, Ask.
8. **Your day.** The conversation opens with a line built from HQ's own
   records (who's waiting, what's due, the next call), with links. No
   model, no budget.
9. **More the assistant can do.** Set a deal's follow-up day and mark a
   project's health (both small, with Undo); stop the timer; make a booking
   link (shown on Calls to copy; its address never goes in the conversation
   or the log); start a proposal (from the AI draft when one waits); draft
   an invoice (money: always asks, and stays a draft). Starting the timer is
   moving a task to Working on.
10. **Pins and recents.** **Pin** in the top bar puts the page you're on at
    the top of your sidebar (up to 12, per person, migration 0073). Recent
    records are kept on the device only, and cleared on sign-out.
    **Default:** recents aren't kept on the server, so viewing a page writes
    nothing.
11. **Voice.** **Speak** beside the box, in the drawer and in the command
    bar, where the browser can turn speech into text. Nothing is recorded
    by HQ.

## Slices

1. Places, hubs and search for pages.
2. Get HQ ready.
3. The assistant: migration, the model's tool use, the actions, Home's box.

## Not now

- Streaming answers as they're written. A message waits for the whole
  answer, as Ask HQ does.
- Sending, posting or paying anything from the assistant.
