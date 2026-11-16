// Plain HTML for the one page the portal's staff side cannot make a normal
// page of: the one-time link shown to the person who invited a client. It is
// the answer to a post, shown once, and never stored by the browser.
function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function linkPage(view: { name: string; email: string; link: string; backTo: string }): string {
  return `<h1>Send this link to ${escapeHtml(view.name)}</h1>
<p class="notice">Email is not set up, so HQ did not send it. Copy the link and send it to ${escapeHtml(view.email)} yourself.</p>
<label>Their one-time link
<input readonly value="${escapeHtml(view.link)}">
<span class="hint">It works once, for a week. It lets them choose a password, so send it only to them. This page will not show it again.</span></label>
<p><a class="button light" href="${escapeHtml(view.backTo)}">Back to the client</a></p>`;
}
