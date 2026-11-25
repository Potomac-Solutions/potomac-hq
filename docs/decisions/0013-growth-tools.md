# 0010. Growth tools: what the website promises, HQ keeps

Status: decided 2026-11-25 at Mikey's request. Asked which tools would help
run the business, based on the landing page, he agreed to all eight below
("everything else is very useful and I agree...let's build them"). The
social media planner was on the same list and is being built separately, so
it is not part of this decision. Open choices are marked **Default**:
Claude's pick, to be confirmed or changed in review. Built by Claude in the
order under "Slices", one pull request into `staging` each.

## Context

potomac.solutions makes promises that HQ can't yet keep track of:

- a newsletter, "Notes from the river", whose form goes nowhere;
- five river stops, a Lab of demos and a Work page of client sites, with no
  record of which of them brings people in;
- a free landing page with four rounds of changes and a final approval,
  then $50 an hour, counted by memory;
- website plans with unlimited support, social media and automations
  through n8n, with nothing a plan client sees each month to show the value;
- a Work page and a footer meant to build trust, with no reviews to show;
- small-town clients who come by word of mouth, with no way to thank the
  person who sent them;
- demo apps that prospects can sign in to, with no record of who looked.

HQ already has the pieces these sit on: the CRM and its call log, the
inquiry form and website booking (both credited to a referral link's
`ref`), the portal, site monitoring and its outages, change requests,
invoices, webhooks, the Today list, Brevo for email, and the site API that
potomac.solutions' server calls with its token.

## Decision

### 1. "Notes from the river", the newsletter

- **Signing up.** The website's server posts a name (optional), an email
  and where on the site it was signed up from to `POST
  /api/site/newsletter`, with the site token, like booking does. HQ's own
  `/newsletter` page has the same form for anyone. A sign-up is pending
  until the person opens the confirm link HQ emails them (**Default:**
  double opt-in, so nobody is added by someone else typing their address).
  The link works for a week.
- **Who gets what.** Each subscriber has the river stop or page they
  signed up from (mountains and farms, lakes and outdoors, roadside,
  history, enterprise, or the site in general) and can be tagged by hand.
  An issue goes to everyone, or to the subscribers of chosen stops.
- **Writing and sending.** Under Sales → Newsletter, write an issue (a
  subject and plain text), send yourself a test, then **Send**. It is sent
  in the background, a batch a minute (**Default:** 50 a minute), so a
  long list doesn't trip Brevo, and each person's send is recorded so a
  restart never sends twice.
- **Leaving.** Every issue ends with Potomac's mailing address (US
  anti-spam law asks for one) and a one-click unsubscribe link, and is
  sent with a `List-Unsubscribe` header, so mail apps show their own
  button. Sending refuses to start until `HQ_CONTACT_ADDRESS` is set.
  Unsubscribing is final for that address unless they sign up again.
- **A subscriber who becomes a lead** is linked when the same email makes
  an inquiry or books a call, so a lead shows it read the newsletter.

### 2. Where leads come from

- **What the site sends.** Every way in from the site (the inquiry form,
  the 60-second planner, website booking and newsletter sign-ups) may
  carry where the person was: `src` (`stop:lakes`, `lab:counter`,
  `work:better-days-towing`, `planner`, `blog:<slug>`), the page's path,
  and `utm_source`, `utm_medium` and `utm_campaign`. HQ keeps the first
  one it sees for each opportunity (**Default:** first touch, since that
  is what made them look), cleaned and cut to length; anything odd is
  dropped, never refused.
- **The planner's answers** arrive as the inquiry's message, and `src` is
  `planner`.
- **Lead sources report** (Reports → Lead sources, `report.view`): for the
  last 30, 90 or 365 days, each source with its leads, how many had a call
  (a booked call or a call logged as talked), got a proposal, and were won,
  with the value won for those who may see values. One line per stop,
  demo, client site, the planner, the newsletter and referral links, plus
  "Other" and "Unknown".
- The opportunity page shows where the lead came from.

### 3. Free landing pages

- A client's **free landing page** is recorded on the client: its address
  (`name.potomac.solutions`, **Default:** a subdomain of potomac.solutions
  only), its status (requested, building, in review, approved, live,
  handed over), and the rounds of changes used.
- **One per person.** A second free page is refused for a client, or for
  anyone whose email or phone is already on another client's free page,
  the same rule as the free call.
- **Rounds.** In the portal, under "Your free landing page", the client
  sees its status, the preview link, and "Rounds of changes: 1 of 4 used".
  Sending a round of changes is one message with what to change. Four
  rounds are free, then **Approve it** is the final approval. Staff can
  record a round sent by phone or email.
- **After four rounds**, the form says more changes are $50 an hour and
  asks the client to tick that they know it's paid. The round goes on Today
  as "Paid changes to price". Changed while building it (slice 4): it does
  not draft a change request, because a change request belongs to a project
  and a free page usually has none. Price it with the client and make the
  change request by hand if the work is big enough to need one.
- **Handing it over.** For a client who wants to host it themselves,
  "Download your site" in the portal (and on the client page) gives a zip
  of the site's repository, read from GitHub through the same token as
  site content, once the page is approved.

### 4. The monthly report to plan clients

- On the first of each month at 8:13, HQ drafts a report for each client
  with an ongoing project: the site's uptime last month (from site
  monitoring's outages), the work done (tasks finished, site content
  published, change requests approved), what's coming up (milestones and
  renewals in the next 60 days), and anything they're waiting on.
- **Default:** hours are not shown. The plans are unlimited support, so a
  count of hours invites the wrong question.
- **Default:** drafted, never sent by itself. Staff read it, add a line of
  their own if they like, and **Send** emails it to the client's billing
  contact. Sent reports stay in the portal under "Monthly reports".
- Today shows "Monthly reports to send" until each is sent or skipped.

### 5. Automations (n8n)

- On a client, **Automations**: each n8n workflow run for them, with its
  name, what it does, a link to it in n8n, and how often it should run
  (every so many minutes or hours, daily or weekly).
- **Heartbeat.** Each automation gets a secret address. n8n posts to it
  at the end of a run (`/hooks/automations/<token>`, with `status=ok` or
  `status=failed` and an optional message), and an Error Trigger workflow
  posts `failed`. HQ keeps the last 50 runs of each.
- **Late or failed.** An automation that failed, or hasn't checked in
  within its schedule plus half again (**Default**), is shown on Today and
  the Sites page, and emailed to the alert address once, then again when
  it recovers, as site monitoring does.
- **Default:** clients see their automations and whether each last ran
  fine in the portal, without the n8n link or the secret.

### 6. Reviews and case studies

- **Asking.** On a client, **Ask for a review** emails their contact a
  link (and shows it in the portal) to write one: stars (1 to 5), a few
  words, the name and town to show, and a box to say it may be published.
  **Default:** the link works for 30 days, once.
- **Approving.** Reviews arrive under Sales → Reviews. Only one marked as
  publishable can be approved, and it can be unpublished at any time.
  Staff can also type in a review a client gave by phone or on Google,
  marked as such.
- **Case studies.** For each client, a case study: a headline, the
  problem, what was built, the result, the live address, and up to six
  screenshots (from the file service), as a draft until published. The
  order on the Work page is set in HQ.
- **The website reads them** from `GET /api/site/showcase` with its token:
  published reviews and published case studies, in order, with their
  screenshots at `GET /api/site/showcase/files/<id>`. Nothing unpublished
  ever leaves HQ.

### 7. Thanking the person who sent them

- **Referred by.** An opportunity can say which client, or which person,
  referred it. Most referrals are a word at the diner, so this is typed in,
  not only clicked.
- **A client's own link.** Each client can have a personal referral link,
  a referral link (as for business cards) tied to that client, shown in
  their portal under "Send a friend our way". An inquiry or booking through
  it is marked as referred by that client.
- **Credit.** When a referred client pays their first invoice, the
  referring client earns a credit. **Default:** $25 each, set in Money →
  Settings. Credits show on the client page and in their portal. **Apply
  credit** on a draft invoice for that client adds a "Referral credit" line
  for up to what is owed; it never makes an invoice zero or less, and a
  credit is used once.

### 8. Who looked at a demo

- **Demos.** Under Sales → Demos, the Lab's demo apps: name, address, and
  the demo sign-in to give a prospect (the usernames and passwords that
  stay the same across the daily reset).
- **Sending.** On an opportunity, **Send demos** picks one or more and
  emails the contact a link to each, with its sign-in. Each link is a
  short address of its own (`/d/<code>`) that counts opens and sends them
  on.
- **Who looked.** Each open is logged on the opportunity's timeline
  ("Opened Counter, the second time"). The first open in a day adds the
  opportunity to Today as "Looked at a demo: follow up", once, for two
  days (**Default**). Programs (link previews) are not counted, as with
  referral links.

## Data

- `newsletter_subscriber`, `newsletter_issue`, `newsletter_send`
- `lead_touch`: an opportunity's first source, path and UTM fields
- `free_page`, `free_page_round`
- `monthly_report`
- `automation`, `automation_run`
- `review`, `review_request`, `case_study`, `case_study_shot`
- `opportunity` gains `referred_by_org` and `referred_by_name`;
  `referral_link` gains `organization_id`; `referral_credit`
- `demo`, `demo_link`, `demo_open`
- Events for each change, named `<record>.<verb>` as elsewhere.

## New permissions

| Key | Admin | Manager | Member | For |
| --- | --- | --- | --- | --- |
| `newsletter.manage` | Yes | Yes | No | Subscribers, writing and sending issues |
| `free-page.manage` | Yes | Yes | Yes | Recording a client's free page and its rounds |
| `client-report.send` | Yes | Yes | No | Reading, changing and sending monthly reports |
| `automation.manage` | Yes | Yes | No | Adding automations, their secret addresses |
| `review.manage` | Yes | Yes | No | Asking for, approving and publishing reviews and case studies |
| `demo.manage` | Yes | Yes | No | The list of demos and their sign-ins |

Seeing automations, free pages and reports on a client needs
`client.view`. Sending demo links needs `contact.edit`, like logging a
call. Referred-by uses `opportunity.edit`; referral credit uses
`referral.manage` to set and `invoice.edit` to apply. The lead sources
report needs `report.view`.

## Slices

1. This decision
2. The newsletter (section 1)
3. Lead sources and the report (section 2)
4. Free landing pages (section 3)
5. Monthly reports (section 4)
6. Automations (section 5)
7. Reviews and case studies (section 6)
8. Referral credit (section 7)
9. Demo tracking (section 8)

## Consequences

- HQ keeps a mailing list for the first time: personal data that needs a
  line in the retention policy (unsubscribed addresses are kept only as a
  one-way hash, so they are never mailed again).
- The website gains three calls to HQ (newsletter, showcase and the `src`
  fields), all with its existing token. Until the website sends them, the
  report shows those leads as "Unknown".
- Free work becomes countable, so the point where it turns paid is clear
  to the client before they reach it.
- Monthly reports, automations and reviews give plan clients something to
  see each month, and the website something true to show.
