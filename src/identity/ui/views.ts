// Plain HTML for the identity screens, until the Zubra shell lands.

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function notices(notice: { problem: string; done: string }): string {
  return (
    (notice.problem ? `<p class="notice" role="alert">${escapeHtml(notice.problem)}</p>` : "") +
    (notice.done ? `<p class="notice" role="status">${escapeHtml(notice.done)}</p>` : "")
  );
}

export function signedInHome(view: { name: string; barHtml: string; notice: { problem: string; done: string } }): string {
  return `<h1>Potomac HQ</h1>
${notices(view.notice)}
<p>You are signed in as ${escapeHtml(view.name)}.</p>
${view.barHtml}`;
}

export function noHqUser(view: { barHtml: string }): string {
  return `<h1>No access</h1>
<p class="notice" role="alert">This account can sign in, but it has not been given access to Potomac HQ. Ask an administrator.</p>
${view.barHtml}`;
}

export function problemPage(view: { title: string; message: string }): string {
  return `<h1>${escapeHtml(view.title)}</h1>
<p class="notice" role="alert">${escapeHtml(view.message)}</p>
<p><a href="/">Back to Potomac HQ</a></p>`;
}
