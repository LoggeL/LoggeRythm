import assert from "node:assert/strict";
import test from "node:test";
import { fittedFontSize, headingWords } from "../src/lib/fitWords.ts";

test("headings wrap between whitespace-separated words", () => {
  assert.deepEqual(headingWords("  Die  Leisen\tRiesen "), ["Die", "Leisen", "Riesen"]);
  assert.deepEqual(headingWords("Mehnersmoos"), ["Mehnersmoos"]);
  assert.deepEqual(headingWords("   "), []);
});

test("a heading whose widest word fits keeps its natural size", () => {
  assert.equal(fittedFontSize(110, 560, 560), 110);
  assert.equal(fittedFontSize(110, 560, 420), 110);
  assert.equal(fittedFontSize(110, 560, 0), 110);
});

test("a word wider than the column shrinks the font until it fits", () => {
  // "Mehnersmoos" at 110px is ~720px wide; the column is 560px.
  const size = fittedFontSize(110, 560, 720);
  assert.ok(size < 110 * (560 / 720), `expected just under the exact fit, got ${size}`);
  assert.ok(size > 110 * (560 / 720) * 0.98, `expected close to the exact fit, got ${size}`);
  assert.ok((720 * size) / 110 <= 560);
});

test("impossible measurements fail loudly", () => {
  assert.throws(() => fittedFontSize(0, 560, 720), /no font size/);
  assert.throws(() => fittedFontSize(110, Number.NaN, 720), /available width/);
  assert.throws(() => fittedFontSize(110, 560, -1), /widest word/);
});
