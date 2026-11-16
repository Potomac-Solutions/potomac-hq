// Plain HTML for errors on the sign-in routes. Everything else in this
// module's UI is a Zubra component.

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function problemPage(view: { title: string; message: string }): string {
  return `<h1>${escapeHtml(view.title)}</h1>
<p class="notice bad" role="alert">${escapeHtml(view.message)}</p>
<p><a href="/">Back to Potomac HQ</a></p>`;
}

/** The one-time link for a new or reset HQ account, shown once to the admin when email did not send it. */
export function userLinkPage(view: { name: string; email: string; link: string }): string {
  return `<h1>Send this link to ${escapeHtml(view.name)}</h1>
<p class="notice">Email is not set up, so HQ did not send it. Copy the link and send it to ${escapeHtml(view.email)} yourself.</p>
<label>Their one-time link
<input readonly value="${escapeHtml(view.link)}">
<span class="hint">It works once, for a week. It lets them choose a password, so send it only to them. This page will not show it again.</span></label>
<p><a class="button light" href="/people">Back to People</a></p>`;
}
