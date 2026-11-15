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
