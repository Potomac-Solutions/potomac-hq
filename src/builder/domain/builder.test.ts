import assert from "node:assert/strict";
import { test } from "node:test";
import { applyChange, checkPath, checkSite, fileAt, filesFromJson, filesToJson, MAX_SITE_CHARS } from "./files.ts";
import { costMicros, dollars, fitsUnderCap, modelById, parseCap, worstCaseMicros, MAX_OUTPUT_TOKENS } from "./pricing.ts";
import { readAnswer, userMessage, HISTORY_TURNS } from "./prompt.ts";
import { EMPTY_STREAM, splitEvents, streamOutcome, streamStep } from "./stream.ts";
import { crc32, zipFiles } from "./zip.ts";
import { checkAsk, checkBuildInput } from "./build.ts";

test("paths stay inside the build and are kinds of file a static site uses", () => {
  for (const good of ["index.html", "styles/site.css", "js/menu.js", "content/site.json", "img/logo.svg", "robots.txt", "site.webmanifest"]) assert.ok(checkPath(good).ok, good);
  for (const bad of ["", "/index.html", "../x.html", "a/../b.html", "a//b.html", ".env", "x/.git/config", "a b.html", "über.html", `${"a".repeat(130)}.html`]) assert.deepEqual(checkPath(bad), { ok: false, error: "path-invalid" }, bad);
  assert.deepEqual(checkPath("run.php"), { ok: false, error: "type-not-allowed" });
  assert.deepEqual(checkPath("photo.jpg"), { ok: false, error: "type-not-allowed" });
});

test("a version needs a home page once it has files, and stays within the limits", () => {
  assert.ok(checkSite({}).ok);
  assert.deepEqual(checkSite({ "about.html": "x" }), { ok: false, error: "no-home-page" });
  assert.deepEqual(checkSite({ "index.html": "x".repeat(MAX_SITE_CHARS + 1) }), { ok: false, error: "site-too-large" });
  const many = Object.fromEntries([["index.html", ""], ...Array.from({ length: 60 }, (_, i) => [`p${i}.html`, ""])]);
  assert.deepEqual(checkSite(many), { ok: false, error: "too-many-files" });
});

test("a change writes and removes on top of the last version, sorted, refused whole if any part is wrong", () => {
  const made = applyChange({ "index.html": "old", "b.css": "b" }, { write: [{ path: "index.html", content: "new" }, { path: "a.js", content: "a" }], remove: ["b.css"] });
  assert.ok(made.ok);
  assert.deepEqual(Object.keys(made.value), ["a.js", "index.html"]);
  assert.equal(made.value["index.html"], "new");
  assert.deepEqual(applyChange({ "index.html": "x" }, { write: [{ path: "ok.css", content: "" }, { path: "../evil.html", content: "" }], remove: [] }), { ok: false, error: "path-invalid" });
  assert.deepEqual(applyChange({ "index.html": "x" }, { write: [], remove: ["index.html"] }), { ok: true, value: {} });
});

test("the preview finds index.html for the site and its folders, and nothing outside", () => {
  const files = { "index.html": "home", "about/index.html": "about", "s.css": "css" };
  assert.equal(fileAt(files, "")?.content, "home");
  assert.equal(fileAt(files, "about/")?.content, "about");
  assert.equal(fileAt(files, "s.css")?.type, "text/css; charset=utf-8");
  assert.equal(fileAt(files, "../secret"), null);
  assert.equal(fileAt(files, "nope.html"), null);
});

test("files go to JSON and back; a stored text that isn't a site reads as none", () => {
  const files = { "index.html": "<h1>Hi</h1>" };
  assert.deepEqual(filesFromJson(filesToJson(files)), files);
  assert.deepEqual(filesFromJson("not json"), {});
  assert.deepEqual(filesFromJson("[1]"), {});
  assert.deepEqual(filesFromJson('{"a.html": 3, "index.html": "x"}'), { "index.html": "x" });
});

test("cost is micro-dollars per token at the model's price, with Haiku's long-prompt rate", () => {
  const opus = modelById("claude-opus-5-5");
  const haiku = modelById("claude-haiku-5-5");
  assert.ok(opus && haiku);
  assert.equal(costMicros(opus, { input: 10_000, output: 1_000 }), 60_000); // $0.04 + $0.02
  assert.equal(costMicros(haiku, { input: 100_000, output: 0 }), 10_000);
  assert.equal(costMicros(haiku, { input: 100_001, output: 0 }), 50_001);
  assert.equal(costMicros(haiku, { input: 3, output: 0 }), 1); // rounded up
  assert.equal(modelById("gpt-5"), null);
});

test("the hard stop reserves every output token, and the cap is never crossed", () => {
  const opus = modelById("claude-opus-5-5");
  assert.ok(opus);
  const worst = worstCaseMicros(opus, 20_000);
  assert.ok(worst >= costMicros(opus, { input: 10_500, output: MAX_OUTPUT_TOKENS }));
  assert.ok(fitsUnderCap(0, 10_000_000, 1_000));
  assert.ok(!fitsUnderCap(1, 10_000_000, 1_000));
  assert.ok(!fitsUnderCap(9_500_000, worst, 1_000));
});

test("money reads as dollars, and a cap is typed in dollars", () => {
  assert.equal(dollars(0), "$0.00");
  assert.equal(dollars(4_200), "$0.004");
  assert.equal(dollars(1_234_567), "$1.23");
  assert.deepEqual(parseCap("10"), { ok: true, value: 1_000 });
  assert.deepEqual(parseCap("$12.50"), { ok: true, value: 1_250 });
  for (const bad of ["", "0.50", "abc", "1e3", "1001", "-5"]) assert.equal(parseCap(bad).ok, false, bad);
});

test("the message carries the facts, brief, recent history, every file and the request", () => {
  const text = userMessage({
    facts: { name: "Better Days Towing", phone: "301-555-0100", address: null, website: null, contact: { name: "Stacy Roberts", email: null, phone: null, title: "Owner" } },
    brief: "Towing in Western Maryland.",
    files: { "index.html": "<h1>Hi</h1>" },
    history: Array.from({ length: HISTORY_TURNS + 2 }, (_, i) => ({ ask: `ask ${i}`, summary: `did ${i}` })),
    ask: "Make the hero darker.",
  });
  assert.match(text, /Business name: Better Days Towing/);
  assert.match(text, /Address: \(not known\)/);
  assert.match(text, /Main contact: Stacy Roberts, Owner/);
  assert.match(text, /<file path="index.html">\n<h1>Hi<\/h1>\n<\/file>/);
  assert.doesNotMatch(text, /ask 1\n/);
  assert.match(text, /ask 7/);
  assert.match(text, /<request>\nMake the hero darker.\n<\/request>$/);
});

test("Claude's answer is read strictly", () => {
  assert.deepEqual(readAnswer({ summary: " Done. ", write: [{ path: "./index.html", content: "x" }], remove: [] }), { ok: true, value: { summary: "Done.", write: [{ path: "index.html", content: "x" }], remove: [] } });
  assert.equal(readAnswer({ write: [{ path: "index.html", content: "x" }] }).ok, true);
  for (const bad of [null, "text", { write: "x" }, { write: [{ path: 1, content: "x" }] }, { write: [], remove: [3] }]) assert.equal(readAnswer(bad).ok, false);
});

test("the stream folds into the tool's input, the token counts and the stop reason", () => {
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 1200, cache_read_input_tokens: 0, output_tokens: 1 } } },
    { type: "ping" },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", name: "save_site", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"summary":"Hi",' } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"write":[],"remove":[]}' } },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } },
    { type: "message_stop" },
  ];
  const state = events.reduce((s, e) => streamStep(s, e, "save_site"), EMPTY_STREAM);
  assert.deepEqual([state.input, state.output, state.stopReason], [1200, 42, "tool_use"]);
  assert.deepEqual(streamOutcome(state), { ok: true, input: { summary: "Hi", write: [], remove: [] } });
  assert.deepEqual(streamOutcome({ ...state, stopReason: "max_tokens" }), { ok: false, error: "too-long" });
  assert.deepEqual(streamOutcome(EMPTY_STREAM), { ok: false, error: "no-answer" });
  assert.deepEqual(streamOutcome(streamStep(state, { type: "error", error: { type: "overloaded_error" } }, "save_site")), { ok: false, error: "api-error" });
});

test("server-sent events split on lines, keeping a partial one", () => {
  const first = splitEvents('event: ping\ndata: {"type":"ping"}\r\n\ndata: {"ty');
  assert.deepEqual(first.data, ['{"type":"ping"}']);
  assert.equal(first.rest, 'data: {"ty');
  assert.deepEqual(splitEvents(`${first.rest}pe":"x"}\n`).data, ['{"type":"x"}']);
});

test("a zip has the right checksums and lists every file", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const zip = zipFiles({ "index.html": "<h1>Hi</h1>", "s.css": "" }, "site", new Date("2026-11-25T12:00:00Z"));
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  assert.match(new TextDecoder().decode(zip), /site\/index\.html<h1>Hi<\/h1>/);
});

test("a build has a name, and a brief and a request of reasonable length", () => {
  assert.deepEqual(checkBuildInput({ name: "  Better   Days ", brief: " x " }), { ok: true, value: { name: "Better Days", brief: "x" } });
  assert.deepEqual(checkBuildInput({ name: " ", brief: "" }), { ok: false, error: "name-missing" });
  assert.deepEqual(checkBuildInput({ name: "x", brief: "y".repeat(4_001) }), { ok: false, error: "brief-too-long" });
  assert.deepEqual(checkAsk("  "), { ok: false, error: "ask-missing" });
  assert.deepEqual(checkAsk(" Darker "), { ok: true, value: "Darker" });
});

test("a month starts at midnight on the 1st in the business time zone", async () => {
  const { monthStart } = await import("./build.ts");
  assert.equal(monthStart("2026-12-01T03:00:00Z", "America/New_York"), "2026-11-01T04:00:00Z");
  assert.equal(monthStart("2026-12-01T06:00:00Z", "America/New_York"), "2026-12-01T05:00:00Z");
});

test("an image is known by its first bytes, and its size is read from its header", async () => {
  const { checkImage, imagePath, imageSize, imageType, isImagePath, MAX_IMAGES } = await import("./image.ts");
  const png = new Uint8Array(33);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x06, 0x40, 0, 0, 0x04, 0xb0]);
  const pngType = imageType(png);
  assert.ok(pngType.ok);
  assert.deepEqual(imageSize(png, pngType.value), { width: 1600, height: 1200 });
  // A JPEG: start, an APP0 segment, then a baseline frame of 800 by 600.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x02, 0x58, 0x03, 0x20, 3, 0, 0, 0, 0]);
  const jpegType = imageType(jpeg);
  assert.ok(jpegType.ok);
  assert.deepEqual(imageSize(jpeg, jpegType.value), { width: 800, height: 600 });
  const webp = new Uint8Array(30);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0x03, 0, 0x57, 0x02, 0]);
  const webpType = imageType(webp);
  assert.ok(webpType.ok);
  assert.deepEqual(imageSize(webp, webpType.value), { width: 800, height: 600 });
  assert.deepEqual(imageType(new TextEncoder().encode("<svg onload=alert(1)>")), { ok: false, error: "image-not-a-picture" });
  assert.deepEqual(imageType(null), { ok: false, error: "image-missing" });
  assert.deepEqual(checkImage({ kind: "photo", alt: " ", bytes: png }, 0), { ok: false, error: "alt-missing" });
  assert.deepEqual(checkImage({ kind: "banner", alt: "x", bytes: png }, 0), { ok: false, error: "kind-invalid" });
  assert.deepEqual(checkImage({ kind: "photo", alt: "x", bytes: png }, MAX_IMAGES), { ok: false, error: "too-many-images" });
  const made = checkImage({ kind: "logo", alt: " The  logo ", bytes: png }, 0);
  assert.ok(made.ok);
  assert.equal(made.value.alt, "The logo");
  const path = imagePath("0190a000-0000-7000-8000-00000000abcd" as never, "logo", made.value.type);
  assert.equal(path, "images/logo-00000000abcd.png");
  assert.ok(isImagePath(path));
  assert.ok(!isImagePath("images/../index.html"));
});

test("the message lists the build's images by path, kind, size and what each shows", () => {
  const text = userMessage({ facts: { name: "X", phone: null, address: null, website: null, contact: null }, brief: "", files: {}, history: [], images: [{ path: "images/logo-00000000abcd.png", kind: "logo", width: 800, height: 200, alt: "The logo" }], ask: "Go." });
  assert.match(text, /<images>\nimages\/logo-00000000abcd\.png \| logo \| 800x200 \| shows: The logo\n<\/images>/);
  assert.match(userMessage({ facts: { name: "X", phone: null, address: null, website: null, contact: null }, brief: "", files: {}, history: [], ask: "Go." }), /<images>\n\(None uploaded\.\)/);
});

test("a zip holds pictures as bytes beside the text files", () => {
  const zip = zipFiles({ "index.html": "hi", "images/photo-000000000001.jpg": new Uint8Array([0xff, 0xd8, 0xff, 0x00]) }, "s", new Date("2026-11-25T12:00:00Z"));
  const end = zip.length - 22;
  assert.equal(new DataView(zip.buffer).getUint16(end + 10, true), 2);
  assert.ok(new TextDecoder("latin1").decode(zip).includes("s/images/photo-000000000001.jpg\xff\xd8\xff\x00"));
});

test("a repository is read as owner/name, or a GitHub address, with an optional branch", async () => {
  const { parseRepo, parseAddress } = await import("./rework.ts");
  assert.deepEqual(parseRepo(" https://github.com/Potomac-Solutions/better-days-towing.git "), { ok: true, value: { owner: "Potomac-Solutions", name: "better-days-towing", branch: null } });
  assert.deepEqual(parseRepo("a/b", "feat/x"), { ok: true, value: { owner: "a", name: "b", branch: "feat/x" } });
  for (const bad of ["", "nobody", "a/b/c", "a/..", "-a/b"]) assert.equal(parseRepo(bad).ok, false, bad);
  assert.deepEqual(parseRepo("a/b", "../x"), { ok: false, error: "branch-invalid" });
  const address = parseAddress("betterdaystowing.com/about#top");
  assert.ok(address.ok);
  assert.equal(address.value.toString(), "https://betterdaystowing.com/about");
  for (const bad of ["http://x.com", "https://user:pw@x.com", "localhost", "ftp://x.com"]) assert.equal(parseAddress(bad).ok, false, bad);
});

test("a static repository is taken as it is; a project is read as reference, home page and readme first", async () => {
  const { planRepo } = await import("./rework.ts");
  const e = (path: string, size = 100) => ({ path, size, sha: path });
  const plain = planRepo([e("index.html"), e("about.html"), e("css/site.css"), e("img/truck.jpg"), e(".github/workflows/ci.yml"), e("node_modules/x/index.js"), e("photos/huge.jpg", 9_000_000)]);
  assert.equal(plain.kind, "static");
  assert.deepEqual(plain.files.map((one) => one.path), ["index.html", "about.html", "css/site.css"]);
  assert.deepEqual(plain.pictures.map((one) => one.path), ["img/truck.jpg"]);
  const project = planRepo([e("package.json"), e("package-lock.json", 90_000), e("src/App.jsx", 3_000), e("README.md", 500), e("index.html", 400), e("src/big.js", 50_000), e("dist/index.html"), e("public/logo.png")]);
  assert.equal(project.kind, "reference");
  assert.deepEqual(project.files.map((one) => one.path), ["index.html", "README.md", "src/App.jsx", "package.json"]);
  assert.deepEqual(project.pictures.map((one) => one.path), ["public/logo.png"]);
});

test("a page from the web is slimmed, and only its same-site links are followed", async () => {
  const { importedAlt, importedImagePath, referenceText, sameSiteLinks, slimPage, MAX_REFERENCE_CHARS } = await import("./rework.ts");
  assert.equal(slimPage("<p>Hi</p>\n\n\n<script>track()</script><!-- note --><svg><path d='M0'/></svg>"), "<p>Hi</p>\n<script>…</script><svg>…</svg>");
  const base = new URL("https://towing.example/");
  const links = sameSiteLinks('<a href="/rates">x</a><a href="https://other.example/">y</a><a href="/rates#a">z</a><a href="menu.pdf">m</a><a href="about.html?x=1">a</a>', base, 10);
  assert.deepEqual(links.map(String), ["https://towing.example/rates", "https://towing.example/about.html"]);
  assert.equal(sameSiteLinks('<a href="/a">1</a><a href="/b">2</a>', base, 1).length, 1);
  const text = referenceText([{ from: "a", text: "x".repeat(MAX_REFERENCE_CHARS + 10) }, { from: "b", text: "never" }]);
  assert.match(text, /\[cut short\]\n<\/source>$/);
  assert.doesNotMatch(text, /never/);
  assert.equal(importedImagePath("img/truck.jpg"), "img/truck.jpg");
  assert.equal(importedImagePath("../x.jpg"), null);
  assert.equal(importedImagePath("img/.hidden.png"), null);
  assert.equal(importedAlt("img/flatbed_on-route-50.jpg"), "From the old site: flatbed on route 50");
});

test("the old site goes in the message as reference", () => {
  const text = userMessage({ facts: { name: "X", phone: null, address: null, website: null, contact: null }, brief: "", files: {}, history: [], reference: { from: "github.com/a/b", text: '<source from="index.html">\n<h1>Old</h1>\n</source>' }, ask: "Go." });
  assert.match(text, /<old_site from="github.com\/a\/b">\n<source from="index.html">\n<h1>Old<\/h1>\n<\/source>\n<\/old_site>/);
});
