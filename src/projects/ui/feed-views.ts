// The calendar address, shown once, on the answer to making it: plain HTML,
// never stored by the browser or sent on.
import { escapeHtml } from "../../shared/ui/page.ts";

export function feedAddressPage(view: { readonly address: string; readonly replaced: boolean }): string {
  const address = escapeHtml(view.address);
  return `<h1>Your calendar address</h1>
${view.replaced ? '<p class="notice good" role="status">Your old address has stopped working. Use this one instead.</p>' : ""}
<label>Subscribe to this in your calendar
<input readonly value="${address}">
<span class="hint">It's private: anyone with it can see your tasks' titles and dates, so don't share it. This page won't show it again; if you lose it, make a new one.</span></label>
<h2>Adding it</h2>
<ul>
<li><strong>Google Calendar:</strong> Other calendars, then From URL, and paste it.</li>
<li><strong>Apple Calendar:</strong> File, then New Calendar Subscription, and paste it.</li>
<li><strong>Outlook:</strong> Add calendar, then Subscribe from web, and paste it.</li>
</ul>
<p>Calendars check it about once an hour. Changes you make in the calendar don't come back to HQ.</p>
<p><a class="button" href="/calendar-feed">Done</a></p>`;
}
