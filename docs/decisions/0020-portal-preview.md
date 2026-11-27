# 0020. Viewing a client's portal from HQ

Status: decided 2026-11-27 at Mikey's request. He asked for a way for an
admin or manager to see a client's portal, to check that features work as
intended and to help a client on a call. He chose **read-only**, and that
**the client is not told**. The choices he didn't make are marked
**Default**: Claude's pick, to be confirmed or changed in review.

## Decision

On a client's page, under *Client portal*, each person whose access is not
turned off has **View their portal**. It opens `/portal` as that person sees
it, with a bar at the top: *You're viewing Ann Baker's portal at Mt. Storm
Bakery, as they see it. Nothing can be changed, and they aren't told.* and
**Stop viewing**, which goes back to the client's page.

- **Who:** anyone with `portal.manage` and `client.view`: admins and
  managers. No new permission and no migration.
- **Read-only:** every form post is refused while it lasts, in the portal
  and in HQ, as with *View as a manager / member* (decision 0016). So are
  the addresses that start a payment by being opened (paying an invoice,
  setting up automatic payment, and the platform's return addresses).
  HQ's own pages show the same bar, so it's clear why a form is refused.
- **The client isn't told.** Nothing changes on their side, and their own
  session is untouched.
- **Logged:** starting and stopping are activity events on the client
  person (`client-user.portal-preview-started`, `-stopped`), with the HQ
  user as the actor. A file opened during a view is logged as that user's
  download, marked `portal-preview`, never as the client's.
- **Checked on every request**, like the role preview: the cookie only names
  the client person. It is honoured only while the HQ user is fully signed
  in (past any second step) and still may manage the portal, and while the
  client person's access is on. Changing either ends the view at once.
- **Default:** someone invited who hasn't signed in yet can be viewed, so a
  portal can be checked before they first see it.
- **Default:** a view lasts at most four hours, like the role preview.
- **Default:** it can't be started from inside *View as a manager /
  member*, so the two never mix.

## How it works

The portal asks one question everywhere: which client is this request from
(`clientSession`, through `clientOf` in `src/app.ts`). During a view, that
answer is the previewed person, carried for the request in an
`AsyncLocalStorage` (`src/portal/infrastructure/preview.ts`). The isolation
rules are unchanged: every portal service still reads only the session's
organization, so a view shows exactly that one client's records.

The session carries `previewedBy`, the HQ user's id, so anything that writes
on a read (today only a file download) can say who really did it.

## Left out

- **Acting on the client's behalf.** Mikey chose read-only.
- **Telling the client.** Mikey chose not to.
- **A picker on the call screen.** For now it's started from the client's
  page; a search box near a call can come later if it is missed.
