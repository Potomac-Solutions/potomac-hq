# 0009. Call mode: a timed, guided phone call

Status: decided 2026-11-24 at Mikey's request: "a more intuitive interface
for starting a phone call with a client and a timer that starts and then a
guide tool to help me stay on track while steering the call to ask relevant
and pertinent questions... a warning after so many minutes essentially t
minutes to go to start wrapping up and scheduling an additional call if
necessary. Other intuitive features like this are appreciated." Sections 1
to 4 are what he asked for; 5 to 7 are Claude's proposals in the same
spirit. The open choices are marked **Default**: Claude's pick, to be
confirmed or changed in review. Built by Claude in the order under
"Slices", one pull request into `staging` each.

Mikey answered three on 2026-11-25, marked **Confirmed**: most calls are
30 minutes, but a call he picks up may get 15 ("Most will be 30 minutes
but if I pick up the phone and can give 15 minutes I may"); a buzz with a
visual cue for wrapping up; and ending forgotten calls after 3 hours.

## Context

A call today is three separate things: a phone number to tap on a contact,
a booked call on the Calls page, and a line in the call log written after
it's over (talked, voicemail or no answer, and a note). Nothing helps
during the call itself. What to ask, what the client is waiting on, what
they owe and when to wrap up are all in Mikey's head or on other pages,
and the length of a call is never recorded.

## Decision

### 1. Start a call

**Start a call** sits on a client, a contact, an opportunity, a booked
call, Today's follow-ups and the going-cold list. One tap:

- opens the **call screen**, with the person's number as a big **Dial**
  button (a `tel:` link: on a phone it opens the dialer and HQ stays open
  behind it);
- starts the **timer**, kept on the server, so a reload, a dropped signal
  or switching apps doesn't lose it;
- sets the **planned length**: a booked call's own length, or
  **Confirmed:** 30 minutes for any other call. One tap on the call screen
  makes it 15, 30, 45 or an hour, for a call picked up with only a few
  minutes to give, and it can be changed in 5-minute steps too.

The screen keeps the phone awake while the call is open (the Screen Wake
Lock API, where the browser has it). It is built for a phone held in one
hand: the timer, the guide and the notes in one column, with the
buttons in thumb's reach. Without scripts it still shows when the call
started and when it's planned to end.

A call is open until it's ended. Only one call can be open per person;
starting another asks to end the first. Starting a call needs
`contact.edit`, like logging one.

### 2. The guide

The call screen shows a **guide**: the questions to work through, picked
for the kind of call, each with a box for the answer.

**Default** guides, written from Potomac's services and editable by
anyone with `knowledge.edit`:

- **First call** (a prospect with no proposal yet): what the business
  does, who its customers are, how they find you now, what's not working,
  what a good result looks like in six months, budget range, timeline,
  who else decides.
- **Proposal follow-up** (a proposal sent and not answered): what they
  thought, any questions about scope or price, what's in the way, when
  they'll decide.
- **Project check-in** (an active project): how it's going for them,
  anything they're waiting on, anything we're waiting on, changes they'd
  like (each one offered as a change request), the next milestone.
- **Renewal** (a renewal due in the next 30 days): still wanted, any
  changes, how they'll pay.
- **Any call**: why they called or why we did, what they need, next step.

HQ picks the guide from what the client has, in that order, and it can be
switched during the call. Above the guide, **talking points** come from
HQ's own records, so the call covers what matters without looking it up:

- what the client is waiting on from Potomac, and what Potomac is waiting
  on from them (approvals, files, answers);
- a proposal sent and not answered: its total and how long ago;
- an invoice overdue: its number, amount and days late;
- a site down or a certificate expiring this month;
- a renewal coming up;
- the last call's note and its date.

**Default:** talking points show only to staff who may see the record
they come from: an invoice's amount needs `invoice.view`, and an
opportunity's value `opportunity.view-value`, as elsewhere.

Ticking a question off, or typing an answer, saves at once, so nothing is
lost if the phone dies.

### 3. Time to wrap up

At a set time before the planned end, the call screen tells you to start
wrapping up: the timer turns amber, the phone vibrates once (where it
can), and a **Wrapping up** panel moves to the top.

- **Default:** the warning comes 5 minutes before the end, or a third of
  the call for a call under 15 minutes (5 minutes before for a 15-minute
  call, 3 for a 10-minute one). It's a setting per person.
- The panel lists what's left: questions not yet asked, a recap of next
  steps, and **Book another call**.
- **Book another call** offers the next free times from the availability
  grid, right on the call screen. Choosing one books it for the client
  and sends the usual booking email; it doesn't end the call.
- At the planned end the timer turns red and counts the overtime up. Nothing
  else interrupts.

**Confirmed:** a buzz and the timer's colour, no sound, so the person on
the line hears nothing.

### 4. Ending the call

**End call** asks for how it went (talked, voicemail, no answer) and opens
the summary, already written from the guide's answers, to edit. Saving it:

- logs the call in the call log as today, with its **length**, the guide
  used, and the note;
- sets the next follow-up, if one is chosen (needs
  `opportunity.set-follow-up`, as now);
- makes a to-do for each next step ticked as ours;
- **Default:** for a client with an active project, offers to log the
  call's time to it (`time.log`), unticked unless the project is billed
  by the hour.

A call left open for 3 hours is ended by HQ, logged with its outcome left
as "talked" and a note saying it was ended automatically. **Confirmed:** 3
hours.

### 5. Proposed: calls to make

A **Calls to make** list on Today: follow-ups due today, opportunities
going cold, overdue invoices worth a call, and calls asked for in the
portal, each with **Start a call**. Ending one offers **Next call** to go
straight on to the one after it. A voicemail shows a short script to read
(editable, like the guides), and **Default:** "no answer" or "voicemail"
sets a follow-up two business days later.

### 6. Proposed: getting ready for a booked call

Fifteen minutes before a booked call (**Default**), Today and the bell
show it with **Get ready**: the talking points, the guide HQ would pick,
and the reason they gave when booking. The call screen opens from there.

### 7. Proposed: the recap email

After a call where you talked, the summary can be sent to the client as a
recap email: what was discussed and the next steps, in the words you saved,
shown in full before sending. It goes from Brevo to the contact, and is
logged as an email in the call log. **Default:** never sent without
**Send recap** being pressed.

## Data

- `call`: a client, optionally a contact, an opportunity and a booking,
  who's on it, the guide, when it started, the planned minutes, the
  warning minutes, when it ended, and the touch it was logged as.
- `call_answer`: a call, a question's place in its guide, whether it was
  asked, and the answer.
- `call_guide` and `call_guide_question`: the guides, which situation each
  is for, and their questions in order.
- `touch` gains `minutes` (the call's length) and `call_id`.
- Events: `call.started`, `call.length-changed`, `call.guide-changed`,
  `call.answered`, `call.ended`, `call.ended-automatically`,
  `call-guide.changed`; and the ones that exist for the call log, follow-ups,
  to-dos, bookings and time.

## New permissions

None. Starting and ending a call uses `contact.edit`, guides use
`knowledge.edit`, and everything a call leads to (follow-ups, bookings,
to-dos, time, the recap email) uses the key it uses today.

## Slices

1. The call screen: start a call, the timer, the planned length, the wrap-up
   warning, the call log with its length (sections 1, 3 and 4, without
   booking from the screen)
2. Guides and talking points (section 2)
3. Booking another call from the call screen, to-dos from next steps, and
   time to the project (the rest of 3 and 4)
4. Calls to make (section 5)
5. Getting ready for a booked call (section 6)
6. The recap email (section 7)

## Consequences

- A call's length is recorded for the first time, so a client's time on
  the phone can be seen and, for hourly projects, billed.
- The call screen keeps a timer on the server for every open call; a
  forgotten one is closed after 3 hours, so lengths stay honest.
- Guides become part of the knowledge HQ keeps, and changing one changes
  every call after it, not calls already logged.
