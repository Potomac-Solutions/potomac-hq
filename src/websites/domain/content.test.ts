import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../shared/domain/id.ts";
import { changesBetween, hasGallery, hasPairs, isPhotoSrc, otherSizes, photosOf, readContent, sameContent, withNotice, withoutPair, withoutPhoto, withoutReview, withPair, withPairMoved, withPairWords, withPhoto, withPhotoIds, withPhotoMoved, withPhotoWords, withReview, writeContent, type SiteContent } from "./content.ts";

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

// ── Before and after ─────────────────────────────────────────────────────

const PAIRS_FILE = JSON.stringify({
  notice: "",
  gallery: [{ src: "/gallery/booth.webp", alt: "A clean paint booth", title: "Paint Booth" }],
  beforeAfter: [
    {
      title: "Ford F-250",
      caption: "Front bumper",
      before: { src: "/gallery/before-after/f250-before-1600.webp", srcSet: "/gallery/before-after/f250-before-480.webp 480w, /gallery/before-after/f250-before-1600.webp 1600w", alt: "A crushed bumper" },
      after: { id: id(7), src: "/gallery/before-after/f250-after-1600.webp", alt: "A straight bumper", focus: "50% 40%" },
    },
  ],
});
const readPairs = (): SiteContent => value(readContent(PAIRS_FILE, newId));
const ids = (n: number) => ({ id: id(n), before: { id: id(n + 1), src: `/gallery/hq-${n}a.jpg` }, after: { id: id(n + 2), src: `/gallery/hq-${n}b.jpg` } });
const WORDS = { title: "Subaru WRX", caption: "Front bumper and fender", beforeAlt: "A scraped bumper", afterAlt: "A clean bumper" };

test("a site's before and afters are read with ids, keep what HQ doesn't know, and write back unchanged", () => {
  const content = readPairs();
  assert.equal(hasPairs(content), true);
  const pair = content.pairs?.[0];
  assert.equal(pair?.title, "Ford F-250");
  assert.equal(pair?.after.id, id(7));
  assert.match(pair?.before.id ?? "", /^0190a000-/);
  assert.deepEqual(pair?.after.extra, { focus: "50% 40%" });
  assert.deepEqual(photosOf(content).map((photo) => photo.src), ["/gallery/booth.webp", "/gallery/before-after/f250-before-1600.webp", "/gallery/before-after/f250-after-1600.webp"]);
  const written = writeContent(content);
  assert.equal((JSON.parse(written) as { beforeAfter: { before: { srcSet: string } }[] }).beforeAfter[0]?.before.srcSet.startsWith("/gallery/before-after/f250-before-480.webp"), true);
  assert.ok(sameContent(value(readContent(written, newId)), content));
});

test("a site with no before and after section has none, and its file gains none", () => {
  const content = read();
  assert.equal(hasPairs(content), false);
  assert.equal("beforeAfter" in JSON.parse(writeContent(content)), false);
  assert.deepEqual(withPair(content, ids(300), WORDS), { ok: false, error: "no-pairs" });
});

test("a before and after that isn't the shape HQ reads is refused", () => {
  const gallery = [{ src: "/gallery/a.webp" }];
  for (const beforeAfter of [{}, [{ title: "x" }], [{ before: { src: "/b.webp" } }], [{ before: { src: "/b.webp" }, after: { src: "/b.webp" } }], [{ before: { src: "/gallery/a.webp" }, after: { src: "/c.webp" } }], [{ before: { src: "../b.webp" }, after: { src: "/c.webp" } }]]) {
    assert.deepEqual(readContent(JSON.stringify({ gallery, beforeAfter }), newId), { ok: false, error: "content-invalid" }, JSON.stringify(beforeAfter));
  }
  assert.ok(readContent(JSON.stringify({ gallery, beforeAfter: [] }), newId).ok, "an empty list is a site with the section and none in it");
});

test("a before and after needs a title and what each photo shows; it can be changed, moved and removed, even the last", () => {
  const content = readPairs();
  assert.deepEqual(withPair(content, ids(300), { ...WORDS, title: " " }), { ok: false, error: "title-missing" });
  assert.deepEqual(withPair(content, ids(300), { ...WORDS, beforeAlt: "" }), { ok: false, error: "before-alt-missing" });
  assert.deepEqual(withPair(content, ids(300), { ...WORDS, afterAlt: "x".repeat(201) }), { ok: false, error: "after-alt-too-long" });
  const added = value(withPair(content, ids(300), WORDS));
  assert.deepEqual(added.pairs?.map((pair) => pair.title), ["Ford F-250", "Subaru WRX"]);
  assert.deepEqual(changesBetween(content, added), ["New before and after: Subaru WRX"]);
  const moved = value(withPairMoved(added, id(300), "first"));
  assert.deepEqual(changesBetween(added, moved), ["Before and after put in a new order"]);
  assert.deepEqual(withPairMoved(moved, id(300), "up"), { ok: false, error: "unchanged" });
  const reworded = value(withPairWords(moved, id(300), { ...WORDS, afterAlt: "A clean, matched bumper" }));
  assert.equal(reworded.pairs?.[0]?.after.alt, "A clean, matched bumper");
  assert.deepEqual(withPairWords(reworded, id(300), { ...WORDS, afterAlt: "A clean, matched bumper" }), { ok: false, error: "unchanged" });
  assert.deepEqual(withPairWords(reworded, id(999), WORDS), { ok: false, error: "no-such-pair" });
  const first = reworded.pairs?.[1]?.id as Id;
  const none = value(withoutPair(value(withoutPair(reworded, id(300))), first));
  assert.deepEqual(none.pairs, []);
  assert.deepEqual(JSON.parse(writeContent(none)).beforeAfter, []);
  assert.deepEqual(changesBetween(content, none), ["Before and after removed: Ford F-250"]);
});

test("a pair's other sizes come from its srcSet, never its own file or a path outside the site", () => {
  const pair = readPairs().pairs?.[0];
  assert.deepEqual(otherSizes(pair!.before), ["/gallery/before-after/f250-before-480.webp"]);
  assert.deepEqual(otherSizes(pair!.after), []);
  assert.deepEqual(otherSizes({ ...pair!.before, extra: { srcSet: "../x.webp 1w, //evil.example/a.jpg 2w" } }), []);
});

test("every photo's id can be renamed, the pairs' sides included", () => {
  const renamed = withPhotoIds(readPairs(), () => id(500));
  assert.deepEqual([...new Set(photosOf(renamed).map((photo) => photo.id))], [id(500)]);
});
