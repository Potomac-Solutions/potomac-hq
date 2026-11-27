# 0022. One person, more than one client, in the portal

Status: decided 2026-11-27 at Mikey's request. He asked that a client's
contact see only their own client's work and settings in the portal, and
that the same person may see more than one client, **but only those where
they are listed as a contact**. The choices he didn't make are marked
**Default**: Claude's pick, to be confirmed or changed in review.

## What was there

- A client user (the portal's person) belonged to exactly one client, for
  good, and an email could be a client user only once in all of HQ. Someone
  who works with two of Potomac's clients, say a bookkeeper or an owner of
  two businesses, couldn't be given the second.
- Inviting someone meant typing their name and email again, even when they
  were already a contact at the client.

## Decision

### 1. Access is per client; the sign-in is per person

- A client user is still one person's access at one client, and never
  moves. One email may now have a client user at several clients, and all
  of them share **one portal account**: one email, one password.
- An email is unique **within a client**, not across them. Migration 0091
  rebuilds `client_user` to say so, keeping every row and every link to it.

### 2. A second client only where they are a contact

- Someone not yet in the portal may be invited at any client, as before.
- Someone already in the portal at another client (invited, signed in, or
  turned off) is given this client **only if their email is listed under
  this client's Contacts**. Otherwise the invite is refused with *That email
  already uses the portal at another client. To give them this one too, add
  them under Contacts here first, then invite them from their row.*
  (`not-a-contact`).
- A matching email alone never joins two clients. Access is always given by
  someone at Potomac pressing invite at that client.

### 3. Given at once, with the same password

- **Default:** when they already sign in, the new client is in their portal
  straight away, with no new link or email. HQ says so: *Stacy Roberts
  already signs in to the portal, so this client is in their portal now,
  with the same password.*
- If their only access so far is an invite they haven't used, the new
  client waits on that same invite: using it opens both.

### 4. One client at a time

- Every portal page, file, download and form is decided by the session's
  client user, as before (`ClientSession`), so the portal shows one
  client's projects, proposals, invoices, files, website, settings and
  calls, and nothing of another's. The isolation tests still hold.
- With more than one client, the top bar shows **Showing [client] / Switch**.
  The choice is kept in a cookie (`hq-portal-client`) that only names a
  client user. It is honoured on every request **only if** that client user
  is this sign-in's and their access there is on; otherwise the first
  client they have access at is shown. A choice that isn't theirs is
  refused (*That business isn’t one you can see.*). Each switch is logged
  (`client-user.switched-client`).
- **Default:** with no choice made, the portal opens at the client they were
  given first.

### 5. Turning access off is per client

- Turning someone off at a client ends their access **there** at once; their
  other clients stay open. HQ says *Access turned off at this client. They
  still see the other clients they have access at.*
- Their sign-in itself is shut, ending every session, only when no client
  is left open to them. Turning one back on opens their sign-in again.
- A new link (forgotten password) is for the person, and works for all
  their clients.

### 6. Inviting from Contacts

- A client's Contacts table has a **Portal** column: *Invite to the portal*
  beside anyone with an email, or where they stand once invited (invited,
  has access, access turned off), matched by email.
- The form for someone who isn't a contact stays, under Client portal, as
  *Invite someone who isn't a contact*.

## Not done

- **Merging two clients where the same person has access at both** is
  refused, since the merged client would hold them twice. Turn one off and
  ask for a fix if it comes up.
- **Removing a contact doesn't take portal access away.** Contacts can't be
  removed in HQ today; when they can, this rule should follow.
- **A person's name** is kept per client, as given at each invite.
