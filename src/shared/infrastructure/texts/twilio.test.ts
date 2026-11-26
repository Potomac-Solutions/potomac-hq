import assert from "node:assert/strict";
import { test } from "node:test";
import { textConfigFrom, twilioSender } from "./twilio.ts";

const SID = "AC" + "0".repeat(32);

test("posts the form to the account's Messages endpoint with basic auth", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const send = twilioSender({ accountSid: SID, authToken: "secret", from: "+13045550100" }, { fetch: (async (url: string, init: RequestInit) => ((seen = { url, init }), new Response("{}", { status: 201 }))) as typeof fetch });
  assert.deepEqual(await send("+13045550142", "Hi"), { ok: true });
  assert.equal(seen!.url, `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
  const form = new URLSearchParams(seen!.init.body as string);
  assert.deepEqual([form.get("To"), form.get("From"), form.get("Body")], ["+13045550142", "+13045550100", "Hi"]);
  assert.equal((seen!.init.headers as Record<string, string>)["authorization"], `Basic ${Buffer.from(`${SID}:secret`).toString("base64")}`);
});

test("a messaging service sends as MessagingServiceSid; STOP comes back as stopped", async () => {
  let form = new URLSearchParams();
  const send = twilioSender({ accountSid: SID, authToken: "t", from: "MG" + "1".repeat(32) }, { fetch: (async (_: string, init: RequestInit) => ((form = new URLSearchParams(init.body as string)), new Response(JSON.stringify({ code: 21610 }), { status: 400 }))) as typeof fetch });
  assert.deepEqual(await send("+13045550142", "Hi"), { ok: false, stopped: true, reason: "twilio-21610" });
  assert.equal(form.get("MessagingServiceSid"), "MG" + "1".repeat(32));
  assert.equal(form.get("From"), null);
});

test("settings: none is off, some is a mistake", () => {
  assert.equal(textConfigFrom({}), null);
  assert.throws(() => textConfigFrom({ HQ_TWILIO_ACCOUNT_SID: SID }), /partly set up/);
  assert.throws(() => textConfigFrom({ HQ_TWILIO_ACCOUNT_SID: SID, HQ_TWILIO_AUTH_TOKEN: "t", HQ_TWILIO_FROM: "304-555-0100" }), /US number/);
  assert.equal(typeof textConfigFrom({ HQ_TWILIO_ACCOUNT_SID: SID, HQ_TWILIO_AUTH_TOKEN: "t", HQ_TWILIO_FROM: "+13045550100" }), "function");
});
