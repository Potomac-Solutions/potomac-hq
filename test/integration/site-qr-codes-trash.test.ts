// A client with QR codes goes to the Trash with them, scans and all, and
// comes back whole (decisions 0023 and 0024).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { clientSignedIn, signIn, testApp, unwrap, type TestApp } from "../support/harness.ts";
import * as crm from "../../src/crm/index.ts";
import { deleteRecords, restoreFromTrash } from "../../src/trash/index.ts";
let t: TestApp;
before(async () => { t = await testApp({ publicUrl: "https://hq.example" }); });
after(() => t.stop());
test("a client with QR codes goes to the Trash and comes back", async () => {
  const admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  await admin.get("/");
  const mikey = t.db.prepare("select id from user where email = 'mikey@example.com'").get()?.["id"] as never;
  const id = unwrap(crm.createClient(t.services.crm, mikey, { name: "Better Days Towing", sizeTier: "small" })).id;
  await admin.post(`/clients/${id}/sites`, { url: "betterdaystowing.com" });
  const towing = await clientSignedIn(t, admin, id, "Stacy", "stacy@example.com");
  await towing.post("/portal/qr-codes", { label: "Cards", page: "/", code: "card" });
  await fetch(`${t.origin}/hooks/site-qr`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://betterdaystowing.com", "user-agent": "Mozilla/5.0 (iPhone) Safari" }, body: "code=card&kind=scan&v=abcd1" });
  assert.equal(t.db.prepare("select count(*) n from site_qr_event").get()?.["n"], 1);
  const gone = deleteRecords(t.services.trash, mikey, "client", [id]);
  assert.ok(gone.ok);
  assert.equal(t.db.prepare("select count(*) n from site_qr_code").get()?.["n"], 0);
  const trashId = t.db.prepare("select id from trash").get()?.["id"] as string;
  const back = restoreFromTrash(t.services.trash, mikey, [trashId]);
  assert.ok(back.ok);
  assert.equal(t.db.prepare("select count(*) n from site_qr_code where created_by_client_user is not null").get()?.["n"], 1);
  assert.equal(t.db.prepare("select count(*) n from site_qr_event").get()?.["n"], 1);
});
