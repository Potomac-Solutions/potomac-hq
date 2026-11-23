// Booking links over real HTTP: booking a free call needs a portal account,
// unless Potomac has given the person a link. With one they say who they
// are and what the call is about, choose a time, and are offered an account
// afterwards.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { actions, httpClient, signIn, testApp, textOf, type Client, type TestApp } from "../support/harness.ts";

let t: TestApp;
let admin: Client;
let member: Client;
const sent: { to: string; subject: string; body: string }[] = [];
const where = (res: Response) => res.headers.get("location") ?? "";
const problemOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("problem") ?? "";
const doneOf = (res: Response) => new URL(t.origin + where(res)).searchParams.get("done") ?? "";
const tokenOf = (label: string) => String(t.db.prepare("select token from booking_link where label = ?").get(label)?.["token"]);
const dana = { name: "Dana Reyes", email: "Dana@ElkDiner.example", phone: "304-555-0142", business: "Elk Diner", topic: "Online orders for the diner, before spring." };
const firstSlot = async (visitor: Client, token: string) => /name="start" value="([^"]+)"/.exec(await (await visitor.get(`/book/with/${token}`)).text())?.[1] ?? "";

before(async () => {
  t = await testApp({ publicUrl: "https://hq.example", email: { publicUrl: "https://hq.example", send: async (m: { to: string; subject: string; body: string }) => (sent.push(m), { ok: true }) } as never });
  admin = await signIn(t, "mikey@example.com", "Mikey Nichols", ["admin"]);
  member = await signIn(t, "sam@example.com", "Sam Rivers", ["member"]);
  await admin.get("/");
  await member.get("/");
  // Free weekdays 9:00 to 11:00. Sign-up to book stays off: only a link books a call.
  await admin.post("/calls/hours/week", Object.fromEntries([1, 2, 3, 4, 5].flatMap((d) => [540, 570, 600, 630].map((m) => [`c-${d}-${m}`, "1"]))));
});
after(() => t.stop());

test("without a link, booking needs an account", async () => {
  const visitor = httpClient(t.origin);
  assert.match(textOf(await (await visitor.get("/book")).text()), /Booking online isn’t open right now|make a free account/);
  assert.match(textOf(await (await visitor.get("/book/with/not-a-real-link-not-a-real-link")).text()), /This booking link isn’t one of ours/);
  assert.equal(problemOf(await visitor.post("/book/with", { link: "not-a-real-link-not-a-real-link", ...dana, start: "2026-12-01T14:00:00Z" })), "That booking link isn’t one of ours. Check it was copied whole.");
  assert.equal(t.db.prepare("select count(*) as n from booking").get()?.["n"], 0);
});

test("Potomac makes a link for someone; a member can't; the link is there to copy", async () => {
  assert.match(textOf(await admin.page("/calls")), /Booking links Booking a call needs a portal account, unless you give someone a link/);
  assert.ok(!textOf(await member.page("/calls")).includes("Booking links"));
  assert.match(problemOf(await member.post("/calls/links", { label: "Dana", lasts: "30", oneTime: "1" })), /permission/);
  assert.equal(problemOf(await admin.post("/calls/links", { label: " ", lasts: "30" })), "Say who the link is for, like Dana at Elk Diner.");
  assert.equal(problemOf(await admin.post("/calls/links", { label: "Dana", lasts: "3650" })), "Choose how long the link lasts from the list.");
  assert.equal(doneOf(await admin.post("/calls/links", { label: "Dana at Elk Diner", lasts: "30", oneTime: "1" })), "Link made. Copy it from the list and send it to them.");
  const token = tokenOf("Dana at Elk Diner");
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const page = await admin.page("/calls");
  assert.ok(page.includes(`value="https://hq.example/book/with/${token}"`), "the whole address, ready to copy");
  assert.match(textOf(page), /Dana at Elk Diner Open One call, until \w+ \d+ · 0 booked/);
  assert.equal(actions(t.db).at(-1), "booking-link.created");
  assert.ok(!JSON.stringify(t.db.prepare("select context from activity_event").all()).includes(token), "the token is never in the activity log");
});

test("with the link, Dana books with no account: who she is, what it's about, and a time", async () => {
  const token = tokenOf("Dana at Elk Diner");
  const visitor = httpClient(t.origin);
  const page = await (await visitor.get(`/book/with/${token}`)).text();
  assert.match(textOf(page), /A free 30-minute call\. No account needed: tell us who you are, then choose a time\. About you Your name Your business .* Your email .* Phone number .* What would you like to talk about\? .* Choose a time/);
  const start = await firstSlot(visitor, token);
  assert.ok(start);

  assert.equal(problemOf(await visitor.post("/book/with", { link: token, ...dana, topic: "", start })), "Say what you’d like to talk about, in a sentence or two.");
  assert.equal(problemOf(await visitor.post("/book/with", { link: token, ...dana, phone: "", start })), "Enter a phone number we can call you on.");
  assert.equal(problemOf(await visitor.post("/book/with", { link: token, ...dana, email: "dana", start })), "Enter your email, like you@example.com.");
  assert.equal(problemOf(await visitor.post("/book/with", { link: token, ...dana, start: "2020-01-01T14:00:00Z" })), "That time was just taken. Choose another.");
  assert.equal(t.db.prepare("select uses from booking_link where token = ?").get(token)?.["uses"], 0, "a try that books nothing doesn't spend the link");

  const booked = await visitor.post("/book/with", { link: token, ...dana, start });
  assert.equal(doneOf(booked), "You’re booked. See you then.");
  assert.match(where(booked), /^\/book\/manage\?token=/);
  const row = t.db.prepare("select kind, name, email, phone, business, topic, link_id is not null as linked, organization_id from booking").get();
  assert.deepEqual({ ...row }, { kind: "public", name: "Dana Reyes", email: "dana@elkdiner.example", phone: "304-555-0142", business: "Elk Diner", topic: dana.topic, linked: 1, organization_id: null });
  assert.equal(actions(t.db).at(-1), "booking.made");

  // Both are emailed; hers has her own link to move or cancel.
  assert.ok(sent.some((m) => m.to === "dana@elkdiner.example" && m.body.includes("/book/manage?token=")));
  assert.ok(sent.some((m) => m.to === "mikey@example.com" && m.body.includes("Dana Reyes")));

  // Her page: the call, and an account offered only if sign-up is open (it isn't yet).
  const manage = await (await visitor.get(where(booked))).text();
  assert.match(textOf(manage), /You’re booked\. See you then\./);
  assert.ok(!textOf(manage).includes("Want an account?"));

  // The link was for one call.
  assert.match(textOf(await (await visitor.get(`/book/with/${token}`)).text()), /This booking link has stopped working/);
  assert.equal(problemOf(await visitor.post("/book/with", { link: token, ...dana, start })), "That booking link has stopped working. Ask Potomac Solutions for a new one.");
  assert.match(textOf(await admin.page("/calls")), /Dana at Elk Diner Used One call, until \w+ \d+ · 1 booked/);
});

test("Potomac sees who booked and why, and adds her to the CRM with the business she named", async () => {
  const page = await admin.page("/calls");
  assert.match(textOf(page), /Dana Reyes Booking link dana@elkdiner\.example · 304-555-0142 · Add to calendar Elk Diner Online orders for the diner, before spring\./);
  assert.match(page, /name="business" value="Elk Diner"/, "the business she named is filled in");
  const id = t.db.prepare("select id from booking").get()?.["id"] as string;
  const added = await admin.post(`/calls/${id}/crm`, { business: "Elk Diner" });
  assert.match(where(added), /^\/opportunities\//);
});

test("she can move her call with her own link, though booking is closed to everyone else", async () => {
  const mail = sent.find((m) => m.to === "dana@elkdiner.example");
  const token = /\/book\/manage\?token=([A-Za-z0-9_-]+)/.exec(mail?.body ?? "")?.[1] ?? "";
  const visitor = httpClient(t.origin);
  const moving = await (await visitor.get(`/book/manage?token=${token}&move=1`)).text();
  const next = [...moving.matchAll(/name="start" value="([^"]+)"/g)].map((m) => m[1] as string)[3] as string;
  assert.ok(next, "open times are offered to move to");
  assert.match(doneOf(await visitor.post("/book/manage/move", { token, start: next })), /Your call is moved/);
});

test("a link for any number of calls; once sign-up is open, an account is offered and not required", async () => {
  await admin.post("/calls/links", { label: "Website footer", lasts: "", oneTime: "" });
  const token = tokenOf("Website footer");
  // Turn on sign-up to book.
  const setup = await admin.page("/calls/hours");
  const field = (name: string) => new RegExp(`name="${name}"[^>]*value="(\\d+)"`).exec(setup)?.[1] ?? "";
  await admin.post("/calls/hours", { "call-minutes": "30", "gap-minutes": field("gap-minutes"), "notice-hours": field("notice-hours"), "days-ahead": field("days-ahead"), "public-open": "1" });
  for (const [name, email] of [["Bo Diaz", "bo@example.com"], ["Cy Park", "cy@example.com"]] as const) {
    const visitor = httpClient(t.origin);
    const booked = await visitor.post("/book/with", { link: token, name, email, phone: "304-555-0100", topic: "A new website", start: await firstSlot(visitor, token) });
    assert.equal(doneOf(booked), "You’re booked. See you then.", name);
    const manage = textOf(await (await visitor.get(where(booked))).text());
    assert.match(manage, /Want an account\? It’s free, and up to you .* Your call is booked either way\. Make a free account/);
  }
  assert.match(textOf(await admin.page("/calls")), /Website footer Open Any number of calls, no end date · 2 booked/);
  assert.equal(t.db.prepare("select count(*) as n from client_user").get()?.["n"], 0, "nobody was made an account");
});

test("a withdrawn link stops working; calls booked with it stay", async () => {
  const id = t.db.prepare("select id from booking_link where label = 'Website footer'").get()?.["id"] as string;
  assert.match(problemOf(await member.post(`/calls/links/${id}/withdraw`, {})), /permission/);
  assert.match(doneOf(await admin.post(`/calls/links/${id}/withdraw`, {})), /Withdrawn/);
  assert.equal(actions(t.db).at(-1), "booking-link.withdrawn");
  const visitor = httpClient(t.origin);
  assert.match(textOf(await (await visitor.get(`/book/with/${tokenOf("Website footer")}`)).text()), /stopped working/);
  assert.equal(t.db.prepare("select count(*) as n from booking where status = 'booked'").get()?.["n"], 3);
  assert.match(textOf(await admin.page("/calls")), /Website footer Withdrawn/);
});

test("ten bookings an hour from one address", async () => {
  await admin.post("/calls/links", { label: "Busy", lasts: "7", oneTime: "" });
  const visitor = httpClient(t.origin);
  t.db.exec("delete from rate_limit where name = 'link-booking'");
  for (let n = 0; n < 10; n += 1) await visitor.post("/book/with", { link: tokenOf("Busy"), ...dana, topic: "" });
  assert.match(problemOf(await visitor.post("/book/with", { link: tokenOf("Busy"), ...dana, topic: "" })), /a lot of bookings at once/);
});
