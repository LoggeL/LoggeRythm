import assert from "node:assert/strict";
import test from "node:test";

import { fullscreenTheme, relativeLuminance, contrastRatio } from "../src/lib/fullscreenTheme.ts";

const panel = [21, 23, 30];
const parse = (value) => value.match(/\d+/g).map(Number);
const covers = [
  [255, 255, 255],
  [255, 225, 0],
  [140, 240, 170],
  [14, 26, 74],
  [124, 92, 255],
  [116, 82, 237],
  [255, 0, 0],
  [0, 0, 0],
  [110, 110, 110],
];

test("exact cover RGB drives both filled buttons and seekbars", () => {
  for (const rgb of covers) {
    const theme = fullscreenTheme({ rgb });
    assert.deepEqual(parse(theme["--accent"]), rgb);
    assert.deepEqual(parse(theme["--accent-solid"]), rgb);
    assert.equal(theme["--cover-primary-rgb"], rgb.join(" "));
    assert.deepEqual(theme, fullscreenTheme(rgb));
  }
});

test("cover and hover backgrounds both keep the chosen foreground readable", () => {
  for (const rgb of covers) {
    const theme = fullscreenTheme(rgb);
    const foreground = parse(theme["--on-accent"]);
    const hover = parse(theme["--accent-hover"]);
    assert.ok(contrastRatio(rgb, foreground) >= 4.5, `${rgb} foreground contrast`);
    assert.ok(contrastRatio(hover, foreground) >= 4.5, `${rgb} hover contrast`);
    assert.ok(contrastRatio(parse(theme["--accent-soft"]), panel) >= 7, `${rgb} soft contrast`);
  }
});

test("bright covers use charcoal and dark covers use off-white", () => {
  assert.deepEqual(parse(fullscreenTheme([255, 225, 0])["--on-accent"]), [11, 12, 16]);
  assert.deepEqual(parse(fullscreenTheme([14, 26, 74])["--on-accent"]), [245, 245, 247]);
  // The app's violet narrowly misses 4.5 with charcoal, so only the label darkens.
  const violet = [124, 92, 255];
  assert.ok(contrastRatio(violet, [11, 12, 16]) < 4.5);
  assert.ok(contrastRatio(violet, parse(fullscreenTheme(violet)["--on-accent"])) >= 4.5);
});

test("hover and readable text preserve primary hue rather than borrowing another colour", () => {
  for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255]]) {
    const primaryChannel = rgb.indexOf(255);
    const theme = fullscreenTheme(rgb);
    for (const key of ["--accent-hover", "--accent-soft"]) {
      const derived = parse(theme[key]);
      assert.equal(derived.indexOf(Math.max(...derived)), primaryChannel);
      const companions = derived.filter((_, index) => index !== primaryChannel);
      assert.equal(companions[0], companions[1]);
    }
  }
});

test("luminance follows WCAG reference values and contrast is symmetric", () => {
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  assert.equal(relativeLuminance([255, 0, 0]), 0.2126);
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrastRatio([255, 255, 255], [0, 0, 0]), 21);
  assert.equal(contrastRatio([14, 26, 74], [14, 26, 74]), 1);
});

test("missing palette inherits existing scoped values and invalid channels fail clearly", () => {
  assert.deepEqual(fullscreenTheme(null), {});
  for (const rgb of [[0, 0], [0, 0, 0, 0], [0, -1, 255], [256, 0, 0], [Number.NaN, 0, 0], [0.5, 0, 0]]) {
    assert.throws(() => fullscreenTheme(rgb), /three integer RGB channels/);
    assert.throws(() => relativeLuminance(rgb), /three integer RGB channels/);
  }
  assert.throws(() => fullscreenTheme("red"), /RGB palette/);
});

test("arbitrary RGB colours meet contrast without altering their primary", () => {
  for (let r = 0; r <= 255; r += 17) {
    for (let g = 0; g <= 255; g += 17) {
      for (let b = 0; b <= 255; b += 17) {
        const rgb = [r, g, b];
        const theme = fullscreenTheme(rgb);
        const foreground = parse(theme["--on-accent"]);
        assert.deepEqual(parse(theme["--accent-solid"]), rgb);
        assert.ok(contrastRatio(rgb, foreground) >= 4.5);
        assert.ok(contrastRatio(parse(theme["--accent-hover"]), foreground) >= 4.5);
        assert.ok(contrastRatio(parse(theme["--accent-soft"]), panel) >= 7);
      }
    }
  }
});
