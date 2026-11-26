import assert from "node:assert/strict";
import test from "node:test";
import { compileSource } from "./support/compile.mjs";

const { isSameLocation, isSameLocationLinkClick } = await import(await compileSource("src/lib/sameLocation.ts", {}, "sameLocation"));

const here = { href: "https://loggerythm.example/library?tab=liked" };

test("only the exact current page counts as the same location", () => {
  assert.equal(isSameLocation("/library?tab=liked", here), true);
  assert.equal(isSameLocation("https://loggerythm.example/library/?tab=liked", here), true, "trailing slash");
  assert.equal(isSameLocation("/library", here), false, "other tab");
  assert.equal(isSameLocation("/library?tab=recent", here), false, "other tab");
  assert.equal(isSameLocation("/library?tab=liked#top", here), false, "anchor");
  assert.equal(isSameLocation("/", here), false);
  assert.equal(isSameLocation("https://elsewhere.example/library?tab=liked", here), false, "other origin");
  assert.equal(isSameLocation("/", { href: "https://loggerythm.example/" }), true, "home");
});

class FakeElement {
  constructor(attrs) { this.attrs = attrs; }
  closest(selector) { return selector === "a[href]" && "href" in this.attrs ? this : null; }
  getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
  hasAttribute(name) { return name in this.attrs; }
}
globalThis.Element = FakeElement;

const click = (attrs, extra = {}) => ({
  defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
  target: new FakeElement(attrs), ...extra,
});

test("a plain click on a link to the current page is stopped, everything else passes", () => {
  assert.equal(isSameLocationLinkClick(click({ href: "/library?tab=liked" }), here), true);
  assert.equal(isSameLocationLinkClick(click({ href: "/library?tab=recent" }), here), false);
  assert.equal(isSameLocationLinkClick(click({ href: "/library?tab=liked" }, { metaKey: true }), here), false, "new tab");
  assert.equal(isSameLocationLinkClick(click({ href: "/library?tab=liked" }, { button: 1 }), here), false, "middle click");
  assert.equal(isSameLocationLinkClick(click({ href: "/library?tab=liked", target: "_blank" }), here), false);
  assert.equal(isSameLocationLinkClick(click({ href: "/library?tab=liked", download: "" }), here), false);
  assert.equal(isSameLocationLinkClick(click({}), here), false, "no link");
  assert.equal(isSameLocationLinkClick(click({ href: "/library?tab=liked" }, { defaultPrevented: true }), here), false);
});
