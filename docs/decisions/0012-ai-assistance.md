# 0012. AI assistance: drafts for every part of the day

Numbered 0012: the site builder took 0010 and social media 0011 on the
same day, while this was being built.

Status: decided 2026-11-25 at Mikey's request: "Make a roadmap I want all of
these features", then "build this out in its own feature branch … keep going
until it's complete and ask questions after". The plan is the
[Potomac HQ AI Assistance Roadmap](https://claude.ai/artifact/Rf8dBHiNpg3KaQtRuinyNK).
Mikey answered two choices on 2026-11-25, marked **Confirmed**: a budget of
$20 a month and Claude Haiku 5.5, both changeable in the settings ("I want the
settings panel to let me adjust the model and budget anyway"). The other open
choices are marked **Default**: Claude's pick, to be confirmed or changed in
review. Built by Claude.

## Context

Until 0.16.0 HQ had no AI. Mikey's day has a lot of writing that follows a
pattern: a recap after each call, a reply to each lead, a nudge to a quiet
deal, a proposal from a template, a weekly word to each client, expenses
typed from receipts. HQ already holds the facts each of those needs.

## Decision

### Ground rules

- **Drafts only.** AI never sends an email or a portal message, changes money
  or moves a task by itself. Everything it writes is a draft a person uses or
  discards. Using one goes through the module that owns it (the recap form,
  `logTouch`, `startProposal`, `addChangeRequest`, `postProjectUpdate`,
  `addExpense`), with its own permission check.
- **One key.** The key is `HQ_ANTHROPIC_API_KEY` on the server, never in the
  database: the same key as the site builder (decision 0010). As there, only
  the person whose email is `HQ_SITE_BUILDER_OWNER` (Mikey) changes the
  model, its prices, the budget and which features are on; other admins
  (`ai.manage`) see them. **Confirmed:** Claude Haiku 5.5 and $20 a month to
  start.
- **Its own budget.** **Default:** the drafts' $20 is apart from the site
  builder's $10 cap, so a long build never stops a recap, and the reverse.
  The roadmap planned one budget for both; the site builder shipped first
  with its own, so whether to join them is Mikey's call.
- **A hard stop.** Before each call HQ works out the most it could cost (its
  words at about three characters a token, a picture at 5,000 tokens, and the
  longest answer allowed) and refuses it if that could take the month past the
  budget. A warning shows from 80%.
- **Off until turned on.** Each feature has its own switch in Settings → AI,
  and all start off.
- **HQ works without it.** No key, budget spent, a feature off or Claude down:
  the buttons say so, and every page works as before. A site alert never
  waits on AI: if it fails, the alert goes as it was.
- **AI gives no one more.** Asking for, seeing and using a feature's drafts
  needs the permissions the finished thing needs (the matrix lists them).
- **The least data.** Each feature reads only the records it needs, without
  deal values or money owed, never passwords or anything like a card number.
  A receipt's card number is stripped even if the model copies it.
- **Records are data.** Inquiries and client messages are written by people
  outside Potomac. Every prompt passes records inside `<records>` tags and
  says never to follow instructions found there; answers are read as JSON and
  each field checked, and an answer that doesn't fit is refused whole.
- **Every call is logged** with its feature, record, model, token counts,
  cost, who asked (or HQ itself) and what became of the draft, and as an
  activity event (`ai.drafted`, `ai.failed`).
- **Prompts live in the repo** (`src/ai/domain/prompts.ts`), tested like any
  other domain code.

### The features

| Phase | Feature | Where | Using it |
| --- | --- | --- | --- |
| 0 | Settings, usage and drafts | Settings → AI; AI drafts; Today | Admins set it up; anyone sees their own drafts |
| 1 | Call recap | The recap page after a call | Fills the recap email; next steps become to-dos with one button; marked used when the recap is sent |
| 1 | Get ready brief | Get ready, before a booked call | Read in place; says when HQ's records have changed since |
| 2 | Lead triage | A deal's page; AI drafts | HQ triages new deals by itself every five minutes. Keep as a note, close as spam, or send the reply |
| 2 | Going-cold check-ins | A deal's page; "Draft a check-in" on Today | Sent only when pressed, and logged on the deal |
| 2 | Proposal first draft | A deal's page | Starts a proposal (a draft) with the scope and lines, to edit before it's sent |
| 3 | Scope check | A project's page | HQ checks new client messages every five minutes; "Draft the change request" makes a draft change |
| 3 | Weekly client update | A project's page | HQ drafts one per active project on Fridays at 08:13; posted to the portal only when pressed |
| 3 | Ask HQ | Ask HQ | Answers from the knowledge base and decision log only, linking the articles it used |
| 4 | Receipt reading | A project's Money page | Reads a photo or PDF; the expense is added, with the receipt, only when checked |
| 4 | Site-down diagnosis | Site alert emails | A likely cause and first step, added to the alert |
| 5 | Case study drafts | A project's page; Marketing | Copied out by hand (**Default**) |
| 5 | Social post drafts | A project's page; Marketing | Copied out by hand (**Default**): HQ posts nothing |

### Choices to confirm

- **Default:** the key's name is `HQ_ANTHROPIC_API_KEY`.
- **Default:** the order of the phases, as above.
- **Default:** call transcripts are pasted in. HQ records no audio, and
  Claude's API doesn't take it.
- **Default:** weekly updates are drafted on Fridays at 08:13.
- **Default:** Ask HQ reads only the knowledge base and decision log.
- **Default:** case studies wait in Marketing until HQ can publish to the
  website (decision 0003's site content work).
- **Default:** social posts are copied out by hand.
- **Default:** the price guide that lead triage, proposals and the scope
  check price from starts as Potomac's launch prices, editable in Settings →
  AI. HQ has no other record of list prices.
- **Default:** members may use the features their role already allows: lead
  triage and check-ins (`opportunity.edit`, `contact.edit`), weekly updates
  (`project.post-update`) and case studies and posts (`project.edit`).
  Proposal drafts, the scope check and receipts need manager permissions.

## Data

Migration 0058:

- `ai_setting`: one row. The model, its prices in millionths of a dollar per
  million tokens (and Haiku 5.5's dearer rate past 100,000 input tokens), the
  budget in cents, the features on, the price guide, and who changed it last.
- `ai_usage`: every call, with its token counts and cost.
- `ai_draft`: what AI wrote, its status (waiting, used or discarded), the
  fingerprint of the records it came from, and a receipt's picture until the
  draft is used or discarded.

## New permissions

`ai.manage`: admins only. Every feature uses permissions that already exist.

## Prices

From Anthropic's pricing page, October 2026, per million tokens: Haiku 5.5
$0.10 in and $0.50 out (five times that past 100,000 input tokens), Sonnet
5.5 $2 and $10, Opus 5.5 $4 and $20. A recap or a triage is about 1,000
tokens in and 300 out: about $0.0003 on Haiku, so $20 is tens of thousands of
drafts. Another model can be chosen with its own prices.

## Consequences

- HQ depends on Anthropic's API for these features alone; nothing else
  changes when it's down.
- Client and prospect records are sent to Anthropic when a feature is used.
  Check Anthropic's commercial terms on data use, and say so in Potomac's
  privacy notice, before real client data is sent.
- None of it has run against the real API: the tests use a stand-in, and
  `claudeModel` was built from Anthropic's documented Messages API.
