import assert from "node:assert/strict";
import { test } from "node:test";
import { alertAddressFrom, createMonitor } from "./monitor.ts";

function setup(alerts = true) {
  let now = Temporal.Instant.from("2026-11-16T12:00:00Z");
  const lines: Record<string, unknown>[] = [];
  const sent: { to: string; subject: string; body: string }[] = [];
  const monitor = createMonitor({
    name: "https://hq.example",
    clock: () => now.toString(),
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    alert: alerts ? { to: "mikey@example.com", send: async (message) => (sent.push(message), { ok: true }) } : null,
  });
  return { monitor, lines, sent, pass: (minutes: number) => void (now = now.add({ minutes })) };
}

test("an error is one line of JSON with its stack", () => {
  const { monitor, lines } = setup(false);
  monitor.report("Page failed: GET /clients", new TypeError("boom"));
  monitor.report("Plain message");
  monitor.note("Started");
  assert.equal(lines.length, 3);
  assert.deepEqual([lines[0]?.["level"], lines[0]?.["message"], lines[0]?.["at"]], ["error", "Page failed: GET /clients", "2026-11-16T12:00:00Z"]);
  const error = lines[0]?.["error"] as { name: string; message: string; stack: string };
  assert.deepEqual([error.name, error.message], ["TypeError", "boom"]);
  assert.match(error.stack, /monitor\.test\.ts/);
  assert.equal(lines[1]?.["error"], undefined);
  assert.equal(lines[2]?.["level"], "info");
});

test("the same error is emailed once per quiet period, and the next alert says how many were held", async () => {
  const { monitor, sent, pass } = setup();
  const a = "11111111-1111-4111-8111-111111111111";
  const b = "22222222-2222-4222-8222-222222222222";
  monitor.report(`Page failed: GET /projects/${a}`, new Error("boom"));
  monitor.report(`Page failed: GET /projects/${b}`, new Error("boom"));
  monitor.report("Scheduled backup failed", new Error("no bucket"));
  await monitor.settled();
  assert.deepEqual(sent.map((m) => m.subject), ["Potomac HQ error: Page failed: GET /projects/<id>", "Potomac HQ error: Scheduled backup failed"]);
  assert.equal(sent[0]?.to, "mikey@example.com");
  assert.match(sent[0]?.body ?? "", /https:\/\/hq\.example[\s\S]*Error: boom/);
  pass(16);
  monitor.report(`Page failed: GET /projects/${a}`, new Error("boom"));
  await monitor.settled();
  assert.equal(sent.length, 3);
  assert.match(sent[2]?.body ?? "", /happened 1 more time since the last alert/);
});

test("a failing alert is logged and nothing is thrown", async () => {
  const lines: string[] = [];
  const monitor = createMonitor({ name: "hq", clock: () => "2026-11-16T12:00:00Z", write: (line) => lines.push(line), alert: { to: "a@example.com", send: async () => ({ error: "brevo-http-401" }) } });
  monitor.report("Something broke", new Error("x"));
  await monitor.settled();
  assert.match(lines[1] ?? "", /The alert email was not sent: brevo-http-401/);
  const throwing = createMonitor({ name: "hq", clock: () => "2026-11-16T12:00:00Z", write: () => { throw new Error("stderr closed"); }, alert: null });
  assert.doesNotThrow(() => throwing.report("x"));
});

test("the alert address is checked", () => {
  assert.equal(alertAddressFrom({}), null);
  assert.equal(alertAddressFrom({ HQ_ALERT_EMAIL: " mikey@example.com " }), "mikey@example.com");
  assert.throws(() => alertAddressFrom({ HQ_ALERT_EMAIL: "mikey" }), /must be an email address/);
});
