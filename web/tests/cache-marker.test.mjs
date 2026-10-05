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
