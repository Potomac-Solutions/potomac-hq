// An automation's secret address, shown once, on the answer to adding it or
// making a new one: plain HTML, never stored by the browser or sent on.
import { escapeHtml } from "../../shared/ui/page.ts";

export function automationSecretPage(view: { readonly name: string; readonly organizationId: string; readonly address: string; readonly fresh: boolean }): string {
  return `<h1>${view.fresh ? "A new address for " : "Added: "}${escapeHtml(view.name)}</h1>
${view.fresh ? '<p class="notice good" role="status">The old address no longer works. Change it in n8n.</p>' : ""}
<p>At the end of each run, have n8n post to this address. It's secret: anyone with it can say the automation ran.</p>
<label>Check-in address
<input readonly value="${escapeHtml(view.address)}">
<span class="hint">This page won't show it again. If it's lost, make a new one.</span></label>
<h2>In n8n</h2>
<ul>
<li>Last node of the workflow: an <strong>HTTP Request</strong> node, method POST, to this address with <code>?status=ok</code> on the end.</li>
<li>For failures: an <strong>Error Trigger</strong> workflow with an HTTP Request node posting to the same address with <code>?status=failed</code>, and a <code>message</code> field if you like.</li>
</ul>
<p><a class="button" href="/clients/${escapeHtml(view.organizationId)}#automations">Done</a></p>`;
}
