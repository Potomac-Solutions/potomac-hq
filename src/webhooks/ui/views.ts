// A webhook's signing secret, shown once, on the answer to making it or
// making a new one: plain HTML, never stored by the browser or sent on.
import { escapeHtml } from "../../shared/ui/page.ts";

export function webhookSecretPage(view: { readonly id: string; readonly url: string; readonly secret: string; readonly fresh: boolean }): string {
  return `<h1>${view.fresh ? "A new signing secret" : "Webhook added"}</h1>
${view.fresh ? '<p class="notice good" role="status">The old secret is no longer used. Change it where you check signatures.</p>' : ""}
<p>HQ posts to <strong>${escapeHtml(view.url)}</strong>, signed with this secret.</p>
<label>Signing secret
<input readonly value="${escapeHtml(view.secret)}">
<span class="hint">Keep it with whatever receives the webhook, like an n8n credential. This page won't show it again; if it's lost, make a new one.</span></label>
<h2>Checking a delivery</h2>
<p>Each delivery is a JSON POST with these headers:</p>
<ul>
<li><code>X-HQ-Event</code>: what happened, like <code>task.done</code>.</li>
<li><code>X-HQ-Delivery</code>: the delivery's id, the same on every try, so a repeat can be ignored.</li>
<li><code>X-HQ-Signature-256</code>: <code>sha256=</code> and the HMAC-SHA256 of the raw body with the secret, in hex.</li>
</ul>
<p>In n8n, a Crypto node can make the HMAC of the body with the secret; compare it with the header and stop if they differ. Answer with any 2xx status; anything else is tried again for a day.</p>
<p><a class="button" href="/webhooks/${escapeHtml(view.id)}">Done</a></p>`;
}
