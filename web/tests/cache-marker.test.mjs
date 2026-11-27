import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const fixture = { state: "local", error: null };
globalThis.__cacheMarkerFixture = fixture;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = import.meta.resolve("react");
const stubs = {
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "@/store/downloads": moduleUrl(`export const useTrackCacheState = () => globalThis.__cacheMarkerFixture.state; export const useTrackCacheError = () => globalThis.__cacheMarkerFixture.error; export const retryTrackCacheStatus = async () => {}; export const reportTrackCacheFailure = () => {};`),
  "@/components/icons": moduleUrl(`import {createElement} from ${JSON.stringify(reactUrl)}; export const DownloadedIcon = (props) => createElement("svg", props);`),
  "@/components/ui/Tooltip": moduleUrl(`import {createElement} from ${JSON.stringify(reactUrl)}; export default function Tooltip({label, children}) { return createElement("span", {"data-tooltip": label}, children); }`),
};
const source = await readFile(new URL("../src/components/CacheMarker.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
  assert.ok(stubs[name], `Unmocked cache-marker import: ${name}`);
  return `from ${JSON.stringify(stubs[name])}`;
});
const { default: CacheMarker } = await import(moduleUrl(compiled));

test("offline availability survives a server-status failure with a separate retry action", () => {
  fixture.state = "local";
  fixture.error = "Server-Cache konnte nicht geladen werden: Offline";
  const html = renderToStaticMarkup(createElement(CacheMarker, { trackId: "1" }));
  assert.match(html, /aria-label="Offline verfügbar"/);
  assert.match(html, /Offline auf diesem Gerät verfügbar/);
  assert.match(html, /Server-Cache konnte nicht geladen werden/);
  assert.match(html, /Erneut versuchen/);
});

test("failed unknown availability is explicit without a successful availability marker", () => {
  fixture.state = null;
  fixture.error = "Offline-Cache konnte nicht gelesen werden";
  const html = renderToStaticMarkup(createElement(CacheMarker, { trackId: "1" }));
  assert.match(html, /Offline-Cache konnte nicht gelesen werden/);
  assert.doesNotMatch(html, /<svg/);
  fixture.error = null;
  assert.equal(renderToStaticMarkup(createElement(CacheMarker, { trackId: "1" })), "");
});

test("party serverStored flag displays the muted server icon while local offline state keeps precedence", () => {
  fixture.error = null;
  fixture.state = null;
  const serverHtml = renderToStaticMarkup(createElement(CacheMarker, { trackId: "1", serverStored: true }));
  assert.match(serverHtml, /aria-label="Auf dem Server gespeichert"/);
  assert.match(serverHtml, /text-subtle/);

  fixture.state = "local";
  const localHtml = renderToStaticMarkup(createElement(CacheMarker, { trackId: "1", serverStored: true }));
  assert.match(localHtml, /aria-label="Offline verfügbar"/);
  assert.match(localHtml, /text-success/);
});

test("anonymous party guests skip authenticated store fetch and still surface party cache errors loudly", () => {
  fixture.state = "local";
  fixture.error = "401 Unauthorized";
  const storedHtml = renderToStaticMarkup(
    createElement(CacheMarker, { trackId: "1", serverStored: true, skipStoreFetch: true }),
  );
  assert.match(storedHtml, /aria-label="Auf dem Server gespeichert"/);
  assert.doesNotMatch(storedHtml, /401 Unauthorized/);

  const errHtml = renderToStaticMarkup(
    createElement(CacheMarker, {
      trackId: "1",
      serverStored: false,
      skipStoreFetch: true,
      externalError: "Server-Cache konnte nicht geladen werden: 503",
    }),
  );
  assert.match(errHtml, /Server-Cache konnte nicht geladen werden: 503/);
  assert.match(errHtml, /Erneut versuchen/);
});
