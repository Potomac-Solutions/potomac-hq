# Using Potomac HQ

A guide for someone new to HQ. It follows the work in the order it happens.

## Getting in

You get an email, or a link from an admin. Open it and choose a password of
at least 10 characters. The link works once.

- **Forgot your password?** Use "Forgot your password?" on the sign-in page
  if email is set up. If not, ask an admin for a new link.
- **Settings**, top right, has the theme (light, dark, or follow your
  device), your password, two-factor sign-in, and the People list.
- **Two-factor sign-in.** Turn it on in Settings and HQ asks for a code from
  an authenticator app on your phone after your password. Keep the recovery
  codes it shows you somewhere safe: each signs you in once if you lose the
  phone. Used most of them? Settings makes ten new ones, with a code from
  the app, and the old ones stop working. With neither phone nor codes, an
  admin can reset it from the People page.
- **Passkeys.** Instead of an app, or beside one, use a passkey: your
  fingerprint, face or PIN on your phone or computer, or a security key.
  In Settings, choose "Turn on with a passkey", or "Add a passkey" once
  two-factor sign-in is on. After your password, choose "Continue with a
  passkey". Add one for each device you sign in from. A passkey can't be
  typed into a fake sign-in page, so it is the safer of the two.
- **Requiring it of admins.** On People, under Sign-in rules, an admin who
  has it on can require it of every admin. An admin without it can then
  open only Settings until it is on.

## What you can do depends on your role

| Role | In short |
| --- | --- |
| Member | Clients, opportunities, projects, tasks, notes, your own time, the knowledge base |
| Manager | All of that, plus prices, proposals, money, expenses, invoices, reports, inviting clients to the portal, and writing in the knowledge base |
| Admin | Everything, plus People and the audit history |

The full list is in the article "Authorization matrix".

## A lead comes in

1. **Clients**, then "Add a client". Add the person you talk to as a contact.
2. On the client, open an **opportunity**: what they want, and how they
   found Potomac.
3. Move it along the **Pipeline** as it goes: new, consult booked,
   consulted, quoted. Set a follow-up day and it shows on your dashboard
   when it is due.
4. Write what was said in **Notes** on the client or the opportunity.

## The proposal

1. On an opportunity that has been consulted, "Start a proposal". It begins
   from the template for that service.
2. Edit the sections and the estimate lines. Nothing is sent yet.
3. **Send** it. That freezes a numbered version, which never changes, and
   moves the opportunity to quoted. Download the PDF and send it yourself,
   or share it to the client's portal.
4. Record the answer. **Accepted** wins the opportunity, starts the project,
   sets its budget from the estimate, and drafts the deposit invoice, in one
   step. Check the draft and send it: it is on your dashboard.
5. Record the signed agreement against it.

## The project

- **Phases and milestones** are the plan. **Tasks** are the work.
- When a milestone is something the client has to do, like sending photos,
  tick "The client has to do this one". Their portal then puts it first,
  under "waiting on you".
- The **Board** shows tasks by status. Drag a card, or use its menu.
  Moving a task to "Working on" starts your timer. Moving it on stops the
  timer and logs the time.
- **Deliverables** are files for the client. A draft is yours. Share it and
  the client sees it in their portal and approves it or asks for changes.
- **Updates** on a project are what the client reads. **Notes** are
  internal and the client never sees them.
- Set the project's **health** honestly. It is what the dashboard and the
  reports show.

## Time and money

- **Time**: your week. Log hours against a project or task, or let the
  timer do it.
- A project's **Money** tab: hours and cost against the budget, expenses
  with receipts, invoices and payments.
- An **invoice** is drafted, then sent, which gives it its number. Record
  each payment against it. A mistake is voided, never deleted.
- **Billing a client with no project.** A domain or a one-off charge doesn't
  need a project: on the client's page, under Invoices, "Bill a one-off
  charge" drafts one on the client alone (the full amount or something
  else; a deposit or a balance always goes on a project). The Invoices list
  there shows all of the client's invoices, project or not.
- HQ never takes a card number. A payment's reference is a check number or
  the card processor's reference.
- **Money**, in the top bar: every project at a glance, and the CSV exports.

## The client portal

On a client's page, "Invite someone to the portal". They get a link, choose
a password, and see only their own organization's projects, shared
deliverables, shared proposals and sent invoices. They can approve work,
accept a proposal by typing their name, send a message and ask for a call.
What a client does in the portal shows on your dashboard under "From your
clients", and the project's owner is emailed if email is set up.
Call requests show on your dashboard, with the number to call back on if
they gave one. They can also send files on a project: photos, a menu, a
price list. Those show on the project under "Files from the client". Open
one only if you were expecting it.

### Their website

A client can change their own site's gallery photos, a notice line and
their reviews, if you set it up. On the client's page, under Website
editing, say where the site's code lives. HQ reads what is on the site.

From then on, anyone with portal access at that client sees "Your website"
in their portal. What they change waits: nothing reaches the site until
you publish it.

1. They make changes and press "Send to Potomac Solutions". Admins are
   emailed, and it shows on the dashboard and under Delivery → Site
   content.
2. Open the site there. Read the list of changes. Look at each new photo
   and at what it says the photo shows: that sentence is read aloud to
   people who can't see the photo, so fix it if it is thin. You can change
   anything yourself before publishing.
3. "Publish to the site" commits the changes to the site's repository.
   The site rebuilds in a minute or two. Or "Send back to the client" with
   a note saying what to fix; it shows first in their portal.

**Opening and closing the site.** At the top of the site's page, and of
the client's "Your website" page, "Is the website open?" chooses what
visitors see: the website, a "Coming soon" page, or a "Closed for
maintenance" page. Give a day and a time and it opens by itself then.
Unlike photos and words, this takes effect as soon as it is saved, by you
or by the client; you are emailed when they change it. While the site is
closed, "Preview the website" opens the real site for whoever has that
link. It needs the site's own address, which you set under "Where it
lives". The holding page keeps people out of the way, not out: don't put
anything on a site that must stay secret until launch.

If you change the site's content file in the repository by hand, press
"Read the site again" on the site's page afterwards, or the next publish
puts back what HQ had.

### Their social media

For a client on social media marketing (decision 0011). On the client's
page, under Social media, press "Set up a plan": tick their networks
(Facebook, Instagram, LinkedIn), add the address of their page on each,
how many posts and blog posts a month (8 and 1 unless they pay for more
or less), and a few lines about the business: how they talk and what to
stay away from. Those lines show beside every post you write.

1. **Write the month.** On the calendar, add each post with its day, its
   networks, the words, and what the picture shows. An Instagram post
   needs its picture. Blog posts are under "Write a blog post". The count
   at the top says how the month stands against the plan.
2. **Send it.** "Send the drafts to the client" puts them in the client's
   portal, under "Your social media", and on their "Waiting on you".
3. **They answer.** They approve the month in one go, or ask for a change
   on any post; asks show on Today under Waiting on you. Change the post
   and send it again. Anything they don't answer in 3 days counts as
   approved, and says so. If they said yes by phone or text, use "The
   client said yes by phone or text" and say how.
4. **Put it up.** On its day, an approved post shows on Today. Open it,
   "Copy the words", "Open Facebook" (or the rest), post it there, then
   "It's up" with the link if you have it. The client sees the link in
   their portal. "Skip or remove" takes a post off with a reason.

Editing a post the client has seen makes it a draft again, to send again.
HQ doesn't post to the networks by itself yet; that needs Potomac to be
a registered business and Meta and LinkedIn to approve the app.

Delivery → Social media shows every client's month at a glance: what's
still to write, what's with the client, and what's due to go up.

## Knowing what is going on

- **Calls.** Managers and admins set the hours for booked calls under
  Calls → Hours and days off. Everyone sees the calls booked, can add one to
  their calendar, and can cancel one with a reason the other side sees.
  With "Clients can book" on, clients choose a time in the portal, and can
  move or cancel their own calls. With "Anyone can book" on, the page at
  `/book` takes bookings from anyone: link to it from the website. A call
  from that page has "Add to the CRM", before or after the call: it makes
  the client, contact and opportunity in one step.
- **Recurring invoices.** On a project's Money page, set up hosting,
  maintenance or a retainer: an amount every month, three months or year.
  HQ makes each invoice in the morning on its day, as a draft or sent. The
  Money page shows what recurs a month and a year.
- **Invoice reminders.** Turn them on under Money, and clients are emailed
  about a sent invoice three days before it is due and when it is late, up
  to two weeks. An invoice's page shows what went, and can leave it out.
- **Sites.** On a client's page, add their website. HQ checks it every five
  minutes, shows it on the dashboard when it's down or its certificate is
  running out, and emails the alert address. Sites lists them all.
- **Referral links.** Under Sales → Referral links, make a link for each
  thing you print: a batch of business cards, a flyer, a sign. Say where a
  scan should go (your website, or `/contact` or `/book` here), then
  download its QR code and put it in the design. HQ counts each scan and
  each inquiry that follows, and shows the rate. You can change where a
  link goes later; the printed code stays the same.
- **Renewals.** On a client's page, add their domain, hosting, certificate
  or licenses, with when each renews. Each shows on the dashboard 30 days
  ahead. Press "Renewed" when it is done, and its date moves on. "Bill the
  client" sends its invoice, due a week before it renews, on the client
  alone (the default) or on one of their projects.
- **A free landing page on their own domain.** Under the client's free
  landing page, choose "Their own domain" instead of a name on
  potomac.solutions. Give when the domain renews, what it costs and what
  they're billed, and HQ adds it to their Renewals, ready to bill.
- **Today.** Start the day here. It's one list, in order: booked calls, what
  clients are waiting on, down sites, anything overdue, then today's
  follow-ups, to-dos and deadlines, and renewals this week. Work down it.
  For a follow-up, "Log a call" opens the opportunity where you log it and
  set the next one.
- **Going cold.** An open opportunity with no follow-up and no contact for
  two weeks shows on Today as going cold. Call them, or set a follow-up if
  you're waiting on them for a reason.
- **Finding a time together.** On a client's page, under Client portal,
  "Ask someone to pick times for a call". They mark every half hour they
  could do on a grid of your free time; you pick one that suits both and
  it's booked. Like a Timeful poll, inside HQ.
- **New people booking a call.** Turn on "Anyone can sign up at /book" on
  the Hours page (it needs email set up), and link your website to /book.
  People sign up, confirm their email, and book in their own portal. Each
  one shows up in the pipeline as "Signed up to book a call".
- **Booking from potomac.solutions.** With the same setting on, the website
  shows your open times. Someone new picks one, gives their name, email and
  phone, and is booked at once. They also get a client account, and an email
  with a link to their dashboard to choose a password and add or change their
  details. One person gets one account: if their email or phone is already on
  file, nothing is booked and the sign-in link goes to the email on file, not
  the one they typed. "+tags", Gmail dots and differently written phone
  numbers count as the same. Demo clients never block anyone. The website
  answers "check your email" either way, so it never tells a visitor who is
  already a client, and both emails ask people to call or text you if it
  wasn't them.
- **Importing clients.** Clients → Import clients: paste a list with a
  header line (Client, Contact, Phone, Email, Project, Pricing, Price,
  Repository, Live, Demo, in any order). Each line becomes a client, its
  contact and, with a Project, the project. Nothing is saved if a line is
  wrong, and clients already in HQ are skipped.
- **Demo clients.** Mark a made-up business you show prospects as a demo
  (on the client's page, or Demo = yes when importing). It keeps its Demo
  badge and stays out of the dashboard, Today and the reports.
- **Booking links.** To let someone book without an account, make them a
  link: Calls → Booking links → say who it's for → Make a link, then copy
  the address and send it. They tell you who they are and what the call is
  about, and choose a time. Withdraw a link to stop it working.
- **Your availability.** Under Calls → Usual week, paint the half hours
  you're free for calls: press and drag across the grid. For one week that's
  different, Calls → Availability this week: paint over it. Busy times from
  your calendar and calls already booked show underneath.
- **Your calendars.** On the Hours page, under Your calendars, paste a
  calendar's private address (Google: Settings → your calendar → "Secret
  address in iCal format"). Its busy times are never offered for calls. Up
  to five. Already keep free times in Timeful or Calendly? On Availability,
  "Fill in from somewhere else" paints the next two weeks from them.
  Clients answering an invite get the same three ways to fill it in.
- **Change requests.** When a client asks for something that wasn't in the
  agreement, don't just do it. On the project's money page, draft a change
  with its price and hours and send it. They approve it in the portal (or
  tell you by phone, and you record it). Approving raises the budget and
  drafts the invoice.
- **Project links.** On a project, add where the work lives: the staging
  site, the designs, the code. Tick "Show it to the client" and it appears in
  their portal, so they always know where to look.
- **On your phone.** HQ works on a phone. From Today, tap "Log a call" on a
  follow-up; the opportunity page has the contact's number as a tap to call,
  and the call log right below it.
- **The morning email.** The same list arrives at 7 each morning, so the day
  starts with it. Turn it off in Settings if you'd rather not.
- **To-dos.** Anything you need to remember to do: "renew the business
  license", "send Rita the quote". Give it a day or leave it for whenever,
  give it to someone else, and add it from a client or an opportunity to tie
  it there. Tick it off when it's done.
- **Calls and messages.** On a client or an opportunity, log each call,
  email, text or meeting. For a call, say how it went. On an opportunity,
  set the next follow-up in the same step: "left a voicemail, try Thursday".
- **A timed call.** "Start a call" on a client, a contact, an opportunity or
  a booked call opens the call screen: a big Dial button, and a timer that
  keeps running if you reload or switch apps. A call is planned for 30
  minutes (a booked call for its own length). Picked up with only 15
  minutes to give? Tap "15 min"; 45 and an hour are there too, and −5 and
  +5 fine-tune it. Five
  minutes before the end the timer turns amber and the phone buzzes once,
  with no sound, and the screen shows what to cover before hanging up. At
  the end it turns red and counts the overtime. Notes save as you type.
  "End call" logs it with how it went and how long it lasted. While you're
  on a call, the top bar has a way back to it from any page.
- **The guide.** Each call starts with questions that fit the client: a
  first call for a new prospect, a follow-up for a proposal waiting, a
  check-in for an active project, or a renewal. Tick each as you ask it and
  jot what they said; it saves as you go and goes in the call log. Above it,
  "Worth raising" lists what HQ knows: what they're waiting on from us, what
  we're waiting on from them, a late invoice, a site that's down, a renewal
  coming up, and what was said last time. Change the questions under
  Knowledge → Call guides.
- **Getting ready.** Fifteen minutes before a booked call, the top bar
  says "Call in 12 minutes with …: get ready". Its page has why they
  booked, what's worth raising and the guide, and "Start the call".
- **Calls to make.** Today lists who to call, one line each with every
  reason: they asked for a call, a follow-up is due, an invoice is a week
  late, a deal is going cold. Tap "Call" and the call screen opens; end it
  and you're back at the list, with that client gone from it. Got their
  voicemail? The script is on the call screen; end it as "Left a voicemail"
  and HQ sets the follow-up two business days on, or a to-do to call again.
- **A recap email.** When you end a call where you talked, tick "Then
  write them a recap email". HQ drafts it from your notes (not the guide's
  answers); change anything, then "Send recap", or "Skip". It's in the call
  log once it's gone.
- **Before you hang up.** The wrap-up panel offers the next open times:
  pick one and "Book it" while they're still on the line, and they're
  emailed it. When you end the call, type next steps, one a line, and each
  becomes a to-do for you; and log the call's time to their project (a
  project billed by the hour is ticked already).
- **Inquiries.** The form at `/contact` (or on the website) puts each
  inquiry in the pipeline as a new opportunity from the website, and emails
  Potomac.
- **Profit and loss.** Money → Profit and loss by month: money received
  against money spent, a year at a time, with a CSV.
- **Search**, in the top bar: type a name, an email, a phone number, an
  invoice number or a few words from a task, and press Enter.

- **Waiting on you**, at the top of the Dashboard: what clients are waiting
  for. Clear it first each day.

- The **Dashboard**: follow-ups due, active projects, deadlines, hours this
  week, projects over budget, calls clients asked for, recent activity.
- **Reports**: the pipeline and win rate, project health and what is late,
  and budget against actual.
- **Knowledge**: how things are done here, and the decision log. Search it
  first. If the answer is not there, write it down once you know it.
- **Audit history** (admins): everything anyone did, with filters. Its
  **Refused attempts** page lists wrong passwords, wrong two-factor codes
  and forms someone tried without permission, for the last 30 days.

## Making a client's website with Claude

Delivery → Site builder (admins only). Choose the client, give the build a
name and write a brief: what the business does, who its customers are, the
tone, the pages wanted. The client's name, phone, address and main contact
come from their page in HQ, so keep those right. Starting asks Claude for
the first version, which takes a minute or two; the page updates by itself.

The preview shows the site as a visitor would, at phone, tablet or full
width. Ask for changes in plain words, one thing at a time ("make the hero
darker", "add a page for towing rates"). Each answer is a new version.
Show an older one, download any one as a .zip, or make an older one the
newest again.

To redo a site a client already has, use "Rework a site they already
have" instead: give its repository (one HQ's GitHub token can read) or its
address, and say in the brief what should change. A repository that is
already plain HTML becomes version 1 as it was; anything else is read and
Claude rewrites it. Pictures from a repository come along with "From the
old site" as their description; fix those under Pictures.

Under Pictures, add the client's photos and logo. Say what each one shows:
Claude reads that to decide where it goes, and the site uses it as the
picture's description. Ask Claude to use them once they're added.

Claude only uses the facts it's given. Where something is missing it
writes a placeholder in square brackets, like [Hours: ask the owner]:
look for those before a site goes anywhere.

When it's right, put it on GitHub under "Put it on GitHub": a new private
repository under Potomac-Solutions, or a pull request to the client's own
repository. A new repository then needs connecting to Railway or Netlify
once; after that, each publish rebuilds the site. Later versions go the
same way as the first.

Each request shows what it cost. This month's spending and what's left
are at the top. A request that could pass the monthly cap isn't sent;
Mikey can change the cap and the model under Model and cap.

## Our own website (potomac.solutions)

Company → Our website (admins only). Pick **Coming soon** or **Down for maintenance**
and visitors to potomac.solutions see one plain page with your heading and
message, while search engines are told to come back later. Switch to **Open to
everyone** to put the site back. It follows within a minute.

To see the real site while it is closed, open the private preview link on that
page once; that browser sees the site for 12 hours. Make a new link any time
and the old one stops working. An announcement, if you write one, shows across
the top of every page while the site is open.

## AI drafts

With the site builder's API key on the server and a feature turned on in
Settings → AI (by the owner in `HQ_SITE_BUILDER_OWNER`; other admins see
it), Claude drafts some of the day's writing. It only ever drafts: you
read it, change it and press the button that sends, posts or saves it, or
discard it. **AI drafts** in the sidebar, and a line on Today, show what's
waiting for you.

**Picking a model.** Next to each "Draft" button, on Ask HQ, and in the site
builder beside "Ask Claude", a Model list lets you pick a model for that one
request. It starts on the usual model and offers only models up to the
highest one the owner allows in Settings → AI ("Highest model anyone may
pick"). A dearer model writes better and costs more, from the same shared
monthly budget. HQ's own jobs (lead triage, scope checks, Friday updates)
always use the usual model. The list doesn't show when there's only one
model to pick.

- **After a call:** on the recap page, "Draft with AI" writes the recap email
  and the next steps from your notes (paste a transcript if you have one).
  "Add these as to-dos" adds the steps.
- **Before a call:** Get ready can write a few lines on the client.
- **A new lead:** HQ triages it by itself: the likely service, a price range
  from the price guide, how urgent it is, whether it's spam, and a reply. On
  the deal's page, keep it as a note, close it as spam, or send the reply.
- **A quiet deal:** "Draft a check-in" on Today or the deal's page.
- **A proposal:** "Draft a proposal" on the deal's page starts one from the
  template and your notes, checked against similar finished jobs. It's a
  draft proposal: edit it before you send it.
- **A client asks for more:** client messages that look beyond what was
  agreed are flagged on the project, with a change request ready to draft.
- **Fridays:** each active project gets a draft update. Post it to the
  portal from the project's page, or discard it.
- **Ask HQ:** ask a question; the answer comes from the knowledge base and
  links the articles it used.
- **Receipts:** on a project's Money page, "Read a receipt with AI" fills in
  an expense from a photo. Check it, then add it; the receipt goes with it.
- **Site alerts:** a likely cause and a first step are added to the email.
- **Marketing:** a project's page drafts a case study or social posts; copy
  them from Marketing, then mark them done.

Settings → AI shows what AI has cost this month, call by call, against one
budget shared with the site builder ($20 a month to start, set under Site
builder → Model and cap). At the budget, AI drafts and the site builder stop
until the first of the month or until the cap is raised; HQ works as usual
without them. A receipt draft nobody uses is discarded after 30 days.

## Habits that keep HQ worth using

1. If a client said it, it goes in a note the same day.
2. An opportunity always has a next follow-up, or it is closed.
3. Time is logged the day it is worked.
4. A decision that someone might ask about later goes in the decision log,
   with the reason.
