// Pins (decision 0015, follow-up): pages a person keeps at the top of their
// sidebar. A pin is an address in HQ and the name it had when it was pinned.

/** The most pins one person keeps. */
export const MAX_PINS = 12;

export type Pin = { readonly href: string; readonly label: string };

/** An address that can be pinned: one of HQ's own pages, not a form's or a file's. */
export function pinnable(href: string): boolean {
  if (href.length < 1 || href.length > 300) return false;
  if (!/^\/(?!\/)[A-Za-z0-9\-._~/?=&%+]*$/.test(href)) return false;
  return !/^\/(assistant|nav|staff|portal|_zubra|assets|api|s\/|book\/|river)/.test(href) && !/\.(csv|pdf|json|zip|ics)(\?|$)/.test(href);
}

/** The address without a done or problem message, and without ?chat=open. */
export function cleanHref(href: string): string {
  const [path = "", query = ""] = href.split("#")[0]?.split("?") ?? [];
  const kept = query
    .split("&")
    .filter((part) => part && !/^(done|problem|chat)=/.test(part))
    .join("&");
  return kept ? `${path}?${kept}` : path;
}
