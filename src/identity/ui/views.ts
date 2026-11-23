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

/** The recovery codes, shown once, when two-factor sign-in has just been turned on. */
export function recoveryCodesPage(codes: readonly string[], fresh = false, withPasskey = false): string {
  const top = fresh
    ? `<h1>New recovery codes</h1>
<p class="notice good" role="status">Your old recovery codes no longer work. Throw them away.</p>`
    : `<h1>Two-factor sign-in is on</h1>
<p class="notice good" role="status">From now on, HQ asks for ${withPasskey ? "your passkey" : "a code from your app"} after your password.</p>`;
  return `${top}
<h2>Your recovery codes</h2>
<p>If you lose your phone${withPasskey ? " or your passkey" : ""}, each of these lets you sign in once instead. Keep them somewhere safe, like a password manager. This page will not show them again.</p>
<ul class="codes" aria-label="Recovery codes">
${codes.map((code) => `<li><code>${escapeHtml(code)}</code></li>`).join("\n")}
</ul>
<p><a class="button" href="/settings#two-factor">I’ve saved them</a></p>`;
}
