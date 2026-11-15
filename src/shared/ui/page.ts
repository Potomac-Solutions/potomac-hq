// The plain HTML page every screen is wrapped in until the Zubra shell lands
// (v0.1 item 6). No script, no external assets.

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · Potomac HQ</title>
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.5; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; }
  label { display: block; margin: 0.75rem 0; }
  input { display: block; width: 100%; padding: 0.5rem; font: inherit; box-sizing: border-box; }
  button { padding: 0.5rem 1rem; font: inherit; }
  form.inline { display: inline; }
  .notice { border-left: 4px solid currentColor; padding-left: 0.75rem; }
</style>
</head>
<body>
<main>
${bodyHtml}
</main>
</body>
</html>`;
}
