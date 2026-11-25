// The plain HTML page for screens the Potomac kit writes itself (the one-time
// link form, the change password form) and for errors on the sign-in routes.
// Every other page is a Zubra component inside the shell (src/app.zb). No
// inline script or style: the content security policy allows neither.

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export const ICON_LINK = '<link rel="icon" href="/assets/potomac-mark.webp" type="image/webp"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png"><meta name="theme-color" content="#0b5cad"><meta name="apple-mobile-web-app-title" content="HQ">';
/** Pages the kit writes have no signed-in person to ask, so they follow the device's light or dark setting. */
export const HEAD_LINKS = `<link rel="stylesheet" href="/assets/theme.css"><link rel="stylesheet" href="/assets/theme-dark.css" media="(prefers-color-scheme: dark)">${ICON_LINK}`;

export function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)} · Potomac HQ</title>
${HEAD_LINKS}
</head>
<body>
<main class="plain-page">
<a class="brand" href="/"><img src="/assets/potomac-mark.webp" alt="" width="32" height="32"> Potomac HQ</a>
${bodyHtml}
</main>
</body>
</html>`;
}
