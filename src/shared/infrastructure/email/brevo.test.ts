import assert from "node:assert/strict";
import { test } from "node:test";
import { brevoSender, emailConfigFrom } from "./brevo.ts";

function fakeFetch(status: number) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(status === 201 ? { messageId: "<1@relay>" } : { code: "unauthorized", message: "Key not found" }), { status });
  }) as unknown as typeof fetch;
  return { calls, fn };
}

test("an email is one POST to Brevo with the key in its header and plain text", async () => {
  const fake = fakeFetch(201);
  const send = brevoSender({ apiKey: "xkeysib-test", from: { email: "hq@potomac.solutions", name: "Potomac HQ" } }, { fetch: fake.fn });
  assert.deepEqual(await send({ channel: "email", to: "ann@example.com", subject: "Hello", body: "Line one" }), { ok: true });
  const call = fake.calls[0];
  assert.ok(call);
  assert.equal(call.url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(call.init.method, "POST");
  assert.equal((call.init.headers as Record<string, string>)["api-key"], "xkeysib-test");
  assert.deepEqual(JSON.parse(call.init.body as string), {
    sender: { email: "hq@potomac.solutions", name: "Potomac HQ" },
    to: [{ email: "ann@example.com" }],
    subject: "Hello",
    textContent: "Line one",
  });
});

test("extra headers go with the message, for the newsletter's one-click unsubscribe", async () => {
  const fake = fakeFetch(201);
  const send = brevoSender({ apiKey: "xkeysib-test", from: { email: "hq@potomac.solutions", name: "Potomac HQ" } }, { fetch: fake.fn });
  await send({ channel: "email", to: "ann@example.com", subject: "Notes", body: "Hi", headers: { "List-Unsubscribe": "<https://hq.example/river/one-click?t=x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } });
  assert.deepEqual(JSON.parse(fake.calls[0]?.init.body as string).headers, { "List-Unsubscribe": "<https://hq.example/river/one-click?t=x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
});

test("a refusal comes back as a code with the status only", async () => {
  const send = brevoSender({ apiKey: "xkeysib-test", from: { email: "hq@potomac.solutions", name: "HQ" } }, { fetch: fakeFetch(401).fn });
  const result = await send({ channel: "email", to: "a@example.com", subject: "s", body: "b" });
  assert.deepEqual(result, { error: "brevo-http-401" });
  assert.deepEqual(await send({ channel: "sms", to: "+13045550100", subject: "", body: "b" }), { error: "channel-not-supported" });
});

test("email settings are all or nothing, and links need an https address", () => {
  assert.equal(emailConfigFrom({}), null);
  assert.throws(() => emailConfigFrom({ HQ_BREVO_API_KEY: "k" }), /set both/);
  assert.throws(() => emailConfigFrom({ HQ_BREVO_API_KEY: "k", HQ_EMAIL_FROM: "not an address", HQ_PUBLIC_URL: "https://hq.example" }), /must be an email/);
  assert.throws(() => emailConfigFrom({ HQ_BREVO_API_KEY: "k", HQ_EMAIL_FROM: "hq@potomac.solutions", HQ_PUBLIC_URL: "http://hq.example" }), /https/);
  assert.equal(emailConfigFrom({ HQ_BREVO_API_KEY: "k", HQ_EMAIL_FROM: "hq@potomac.solutions", HQ_PUBLIC_URL: "https://hq.example/" })?.publicUrl, "https://hq.example");
});
