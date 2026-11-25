# 0011. Social media: plan, approve and post a client's month

Status: decided 2026-11-25 at Mikey's request: "build a new feature ... for
us to manage a customer's social media as promised on the landing page".
The landing page sells social media marketing at $50 a month or $500 a
year: content for Facebook, Instagram and LinkedIn, with the blog written
as part of the package. Mikey answered four questions on 2026-11-25, marked
**Confirmed**. Everything marked **Default** is Claude's pick, to be
confirmed or changed in review. Built by Claude in the order under
"Slices", one commit each, in one pull request into `staging`.

## Context

HQ can sell social media (the `social-media` service on an opportunity, a
proposal template at $50) but has nowhere to do the work. What a client
gets each month, what was written, whether the client said yes, and what
went up and where, would live in a notebook, a text thread and three
browser tabs.

Posting straight to Facebook, Instagram and LinkedIn needs an app approved
by Meta and by LinkedIn, and both ask for a registered business. Potomac
isn't registered yet.

## Decision

### 1. Where it lives

**Confirmed:** inside HQ, as a module of its own (`src/social`). It uses
HQ's clients, portal, time and Today, so nothing has to be kept in step
with another app.

### 2. A client's social media plan

A client has at most one **plan**, set on the client's page under
**Social media**:

- **Networks**: any of Facebook, Instagram and LinkedIn, each with the
  address of the client's page there.
- **Each month**: **Confirmed:** 8 posts and 1 blog post, the plan's
  allowance. Both can be changed per client, for a client paying for more
  or less.
- **About the business**: how they talk, what to post about and what to
  stay away from, in up to 2,000 characters. It shows beside every post
  being written.
- **On or paused.** A paused plan keeps its posts and drops off Today.

### 3. The month's calendar

Each client has a **calendar** per month at `/clients/:id/social`, with a
count against the plan: "6 of 8 posts, 0 of 1 blog post".

A **post** has:

- the **day** it goes up, in that month (**Default:** a day, no time:
  it goes up any time that day);
- the **networks** it goes to, from the plan's;
- the **words**: up to 2,200 characters when it goes to Instagram, 3,000
  otherwise (LinkedIn's limit);
- an optional **link**;
- the **picture**: what it shows, in words (**Default:** words now,
  uploading the picture itself comes with slice 3). Instagram needs one,
  so a post to Instagram without it can't be sent to the client.

A **blog post** has a title and the post itself, up to 20,000 characters,
and a day it goes up. It counts against the blog allowance, not posts.

**Default:** going over the plan is allowed and shown ("9 of 8: one more
than the plan"), never refused. Some months need an extra post.

### 4. The client approves the month

**Confirmed:** the client approves the month's calendar in one go, and
can ask for changes on any single post.

- **Send to the client** sends every draft in the month. The client gets
  it in their portal, under **Social media**, and on **Waiting on you**.
- **Approve the month** approves every post sent that they haven't asked
  to change.
- **Ask for changes** on a post, with a note. It comes back to Potomac on
  **Waiting on you** in HQ. Edited and sent again, it waits for the client
  again.
- **Confirmed:** three days after a post is sent with no answer, it counts
  as approved, and says so: "Approved: no changes asked in 3 days". The
  portal tells the client the day: "If we don't hear from you by Friday,
  December 4, we'll go ahead." (**Default:** three whole days from when it
  was sent, checked every hour.)
- A client without a portal account can say yes by phone or text.
  **Record their approval** in HQ says how.
- An approved post can still be edited. Editing it sends it back to the
  client.

### 5. Putting posts up

**Confirmed:** copy-ready first. HQ doesn't post by itself yet.

- **Today** lists approved posts due today or earlier that aren't up.
- A post's page has **Copy the words**, the picture, and a button to open
  each network at the client's page.
- **Posted** records where it went up, with the link on each network
  (optional). **Skipped** records why.
- Posting straight from HQ is a later decision, once Potomac is
  registered and Meta and LinkedIn approve the app.

### 6. Later, not in these slices

- **Drafting with Claude**: write the month's posts from the plan's notes
  and the client's records. Can use the Claude key and monthly cap the
  site builder (decision 0010) brings.
- **Posting straight to the networks** (section 5).
- **How posts did**: likes, comments, reach. Needs the same app approval.

## Data

- `social_plan`: one per client. Networks and page addresses, posts and
  blog posts a month, about the business, on or paused.
- `social_post`: client, month, day, kind (`post` or `blog`), networks,
  title (blog only), words, link, picture, status (`draft`, `sent`,
  `changes`, `approved`, `posted`, `skipped`), when it was sent and
  approved and by whom (`client`, `staff` recorded, or `auto`), the
  client's note, and where it went up.

## New permissions

| Action | Key | Admin | Manager | Member |
| --- | --- | --- | --- | --- |
| See plans and calendars | `social.view` | Yes | Yes | Yes |
| Set plans, write, send, record approval, mark posted | `social.edit` | Yes | Yes | Yes |

A client sees and approves only their own organization's posts, taken from
their portal session, as with the rest of the portal.

## Slices

1. Plans and the calendar: the plan on a client, writing posts and blog
   posts, the count against the plan, a Social media page listing every
   client's month (sections 2 and 3)
2. The client approves the month: sending, the portal page, approving,
   asking for changes, recording approval, approval after three days
   (section 4)
3. Putting posts up: Today, the post's page with copy and open, the
   picture, posted and skipped (section 5)

## Consequences

- The `social-media` service has a home, and `docs/workflow.md`'s open
  item on monthly volume is closed: 8 posts and 1 blog post.
- A post is never put up without the client's yes or three days of quiet,
  and the record says which.
- Until HQ posts by itself, someone copies each post to the network. HQ's
  job is that nothing due is forgotten.
