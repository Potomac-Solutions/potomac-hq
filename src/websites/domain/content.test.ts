import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { changesBetween, hasGallery, isPhotoSrc, readContent, sameContent, withNotice, withoutPhoto, withoutReview, withPhoto, withPhotoMoved, withPhotoWords, withReview, writeContent, type SiteContent } from "./content.ts";

const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}` as Id;
let next = 100;
const newId = () => id(next++);
const FILE = JSON.stringify({
  notice: "",
  theme: "dark",
  gallery: [
    { src: "/gallery/booth.webp", alt: "A clean paint booth", title: "Paint Booth", caption: "Where refinishing happens.", focus: "50% 22%" },
    { id: id(2), src: "/gallery/parts.webp", alt: "Shelves of parts", title: "Parts Bay" },
  ],
  testimonials: [{ quote: "They made it easy.", by: "Evelyn S. · via Yelp" }],
});
const read = (): SiteContent => {
  const content = readContent(FILE, newId);
  assert.ok(content.ok);
  return content.value;
};
const value = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  assert.ok(result.ok, result.ok ? "" : result.error);
  return result.value;
};

test("the site's file is read: a photo with no id gets one, and fields HQ doesn't know are kept", () => {
  const content = read();
  assert.equal(content.gallery.length, 2);
  assert.match(content.gallery[0]?.id ?? "", /^0190a000-/);
  assert.equal(content.gallery[1]?.id, id(2));
  assert.deepEqual(content.gallery[0]?.extra, { focus: "50% 22%" });
  assert.equal(content.gallery[1]?.caption, "");
  assert.deepEqual(content.extra, { theme: "dark" });
  assert.deepEqual(content.reviews, [{ quote: "They made it easy.", by: "Evelyn S. · via Yelp" }]);
});

test("written and read back, the content is the same, and what HQ didn't know is still there", () => {
  const content = read();
  const written = writeContent(content);
  const file = JSON.parse(written) as { theme: string; gallery: Record<string, unknown>[]; testimonials: unknown[] };
  assert.equal(file.theme, "dark");
  assert.equal(file.gallery[0]?.["focus"], "50% 22%");
  assert.equal("caption" in (file.gallery[1] ?? {}), false, "an empty caption is left out");
  assert.ok(written.endsWith("}\n"));
  const again = readContent(written, newId);
  assert.ok(again.ok && sameContent(again.value, content));
});

test("a file that isn't the shape HQ reads is refused, never half read", () => {
  for (const bad of ["not json", "[]", "{}", '{"gallery":[]}', '{"gallery":[{"src":"gallery/x.webp"}]}', '{"gallery":[{"src":"/../secret.png"}]}', '{"gallery":[{"src":"/a.webp"},{"src":"/a.webp"}]}', '{"gallery":[{"src":"/a.webp"}],"testimonials":[{"quote":"","by":"x"}]}', '{"gallery":[{"src":"/a.txt"}]}']) {
    assert.deepEqual(readContent(bad, newId), { ok: false, error: "content-invalid" }, bad);
  }
  assert.equal(isPhotoSrc("/gallery/hq-0190a0000000.jpg"), true);
  assert.equal(isPhotoSrc("//evil.example/x.jpg"), false);
});

test("a photo needs a title and what it shows; it is added at the end", () => {
  const content = read();
  const photo = { id: id(9), src: "/gallery/hq-9.jpg" };
  assert.deepEqual(withPhoto(content, photo, { title: " ", alt: "x" }), { ok: false, error: "title-missing" });
  assert.deepEqual(withPhoto(content, photo, { title: "Truck", alt: "" }), { ok: false, error: "alt-missing" });
  assert.deepEqual(withPhoto(content, photo, { title: "x".repeat(61), alt: "x" }), { ok: false, error: "title-too-long" });
  assert.deepEqual(withPhoto(content, photo, { title: "Truck", alt: "x".repeat(201) }), { ok: false, error: "alt-too-long" });
  assert.deepEqual(withPhoto(content, photo, { title: "Truck", alt: "x", caption: "x".repeat(201) }), { ok: false, error: "caption-too-long" });
  const added = value(withPhoto(content, photo, { title: "  Red   truck ", alt: "A red truck\nwith a new fender", caption: null }));
  assert.deepEqual(added.gallery.at(-1), { ...photo, title: "Red truck", alt: "A red truck with a new fender", caption: "", extra: {} });
  const full = { ...content, gallery: Array.from({ length: 30 }, (_, n) => ({ ...photo, id: id(200 + n) })).map((one) => ({ ...one, alt: "a", title: "t", caption: "", extra: {} })) };
  assert.deepEqual(withPhoto(full, photo, { title: "Truck", alt: "x" }), { ok: false, error: "too-many-photos" });
});

test("a photo's words change, it moves, and it is removed; the last photo stays", () => {
  const content = read();
  const first = content.gallery[0]?.id as Id;
  assert.deepEqual(withPhotoWords(content, id(77), { title: "x", alt: "y" }), { ok: false, error: "no-such-photo" });
  assert.deepEqual(withPhotoWords(content, first, { title: "Paint Booth", alt: "A clean paint booth", caption: "Where refinishing happens." }), { ok: false, error: "unchanged" });
  const edited = value(withPhotoWords(content, first, { title: "Booth", alt: "A clean paint booth", caption: "" }));
  assert.equal(edited.gallery[0]?.title, "Booth");
  assert.deepEqual(edited.gallery[0]?.extra, { focus: "50% 22%" }, "its crop is kept");
  assert.deepEqual(withPhotoMoved(content, first, "up"), { ok: false, error: "unchanged" });
  assert.deepEqual(value(withPhotoMoved(content, first, "down")).gallery.map((one) => one.id), [id(2), first]);
  assert.deepEqual(value(withPhotoMoved(content, id(2), "first")).gallery.map((one) => one.id), [id(2), first]);
  const one = value(withoutPhoto(content, first));
  assert.deepEqual(one.gallery.map((photo) => photo.id), [id(2)]);
  assert.deepEqual(withoutPhoto(one, id(2)), { ok: false, error: "last-photo" });
});

test("a notice is one line; a review needs words and a name", () => {
  const content = read();
  assert.deepEqual(withNotice(content, ""), { ok: false, error: "unchanged" });
  assert.deepEqual(withNotice(content, "x".repeat(161)), { ok: false, error: "notice-too-long" });
  assert.equal(value(withNotice(content, " Closed Thursday\nand Friday. ")).notice, "Closed Thursday and Friday.");
  assert.deepEqual(withReview(content, { quote: " ", by: "Dale" }), { ok: false, error: "quote-missing" });
  assert.deepEqual(withReview(content, { quote: "Great", by: "" }), { ok: false, error: "by-missing" });
  const added = value(withReview(content, { quote: "“Great work.\n\n\nFast, too.”", by: " Dale P. " }));
  assert.deepEqual(added.reviews.at(-1), { quote: "Great work.\n\nFast, too.", by: "Dale P." });
  assert.deepEqual(withoutReview(added, 5), { ok: false, error: "no-such-review" });
  assert.deepEqual(value(withoutReview(added, 0)).reviews, [{ quote: "Great work.\n\nFast, too.", by: "Dale P." }]);
});

test("what changed reads as sentences someone can check", () => {
  const live = read();
  const first = live.gallery[0]?.id as Id;
  let next = value(withPhoto(live, { id: id(9), src: "/gallery/hq-9.jpg" }, { title: "Red truck", alt: "A red truck" }));
  next = value(withPhotoWords(next, id(2), { title: "Parts", alt: "Shelves of parts" }));
  next = value(withPhotoMoved(next, id(2), "first"));
  next = value(withNotice(next, "Closed Friday."));
  next = value(withReview(next, { quote: "Great", by: "Dale P." }));
  next = value(withoutReview(next, 0));
  assert.deepEqual(changesBetween(live, next), ["New photo: Red truck", "Words changed on a photo: Parts", "Photos put in a new order", "Notice: “Closed Friday.”", "New review from Dale P.", "Review removed: Evelyn S. · via Yelp"]);
  // The first photo is the one shown largest, so losing it is said twice over.
  assert.deepEqual(changesBetween(live, value(withoutPhoto(live, first))), ["Photo removed: Paint Booth", "A different photo comes first"]);
  assert.deepEqual(changesBetween(value(withNotice(live, "Closed")), live), ["Notice taken down"]);
  assert.deepEqual(changesBetween(live, live), []);
});

test("a file with no gallery is a site with nothing but its status and service area: written back as it was", () => {
  const json = JSON.stringify({ serviceArea: { areas: [] }, launch: { mode: "live" }, theme: "dark" });
  const read = readContent(json, () => "0190a000-0000-7000-8000-000000000001" as Id);
  assert.ok(read.ok);
  assert.equal(hasGallery(read.value), false);
  assert.deepEqual(read.value.extra, { theme: "dark" }, "the status and the service area are read on their own");
  assert.deepEqual(JSON.parse(writeContent(read.value, { launch: { mode: "live" }, serviceArea: { areas: [] } })), { theme: "dark", launch: { mode: "live" }, serviceArea: { areas: [] } });
  assert.deepEqual(readContent(JSON.stringify({ gallery: [] }), () => "x" as Id), { ok: false, error: "content-invalid" }, "a gallery, when there is one, still needs a photo");
  assert.deepEqual(readContent("[]", () => "x" as Id), { ok: false, error: "content-invalid" });
  assert.deepEqual(readContent(JSON.stringify({ serviceArea: { areas: [] }, notice: "Hi" }), () => "x" as Id), { ok: false, error: "content-invalid" }, "a notice needs the gallery that comes with it");
  assert.ok(readContent(JSON.stringify({ launch: { mode: "live" } }), () => "x" as Id).ok, "a status alone is enough");
});
