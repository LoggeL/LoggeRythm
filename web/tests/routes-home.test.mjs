import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = {
  me: { id: "user", display_name: "Alex" },
  recent: [],
  requests: [],
  results: {},
  radarEnabled: false,
};
globalThis.__homeScreenFixture = fixture;
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = import.meta.resolve("react");
const empty = moduleUrl("export default function Component() {return null;}");
const stubs = {
  react: reactUrl,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "@tanstack/react-query": moduleUrl(
    `export function useQuery(options) {const fixture = globalThis.__homeScreenFixture; fixture.requests.push(options); return fixture.results[options.queryKey[0]] ?? {data: [], isSuccess: true, isError: false, isLoading: false, isFetching: false, error: null, refetch: async () => {}};}`,
  ),
  "next/link": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, ...props}) {return createElement('a', {...props, href}, children);}`,
  ),
  "@/lib/api": moduleUrl("export const api = {};"),
  "@/store/player": moduleUrl(
    "export const usePlayerStore = (selector) => selector({playQueue() {}});",
  ),
  "@/hooks/useLocalJson": moduleUrl(
    "export const useLocalJson = () => [globalThis.__homeScreenFixture.recent];",
  ),
  "@/hooks/useAuth": moduleUrl(
    "export const useMe = () => ({data: globalThis.__homeScreenFixture.me, isError: false, isFetching: false, error: null, refetch: async () => {}});",
  ),
  "@/hooks/useReleaseRadar": moduleUrl(
    "export const useReleaseRadar = (me) => {globalThis.__homeScreenFixture.radarEnabled = !!me; return {data: [], isSuccess: true};}; export const useReleaseRadarSeen = () => ({unseenCount: 0});",
  ),
  "@/lib/trackArtists": moduleUrl(
    "export const trackArtistLabel = (track) => track.artist;",
  ),
  "@/components/icons": moduleUrl(
    "export function PlayIcon() {return null;} export const RadioIcon = PlayIcon; export const CompassIcon = PlayIcon;",
  ),
  "@/components/CoverPlaceholder": empty,
  "@/components/ShelfCard": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function ShelfCard({shelf}) {return createElement('p', null, shelf.title);}`,
  ),
};
const source = await readFile(
  new URL("../src/app/page.tsx", import.meta.url),
  "utf8",
);
const compiled = ts
  .transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  })
  .outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
    assert.ok(stubs[name], `Unmocked route import: ${name}`);
    return `from ${JSON.stringify(stubs[name])}`;
  });
const { default: HomePage } = await import(moduleUrl(compiled));
function screen() {
  fixture.requests = [];
  return renderToStaticMarkup(createElement(HomePage));
}

test("Home fetches only personalized content and keeps discovery features reachable", () => {
  fixture.me = { id: "user", display_name: "Alex" };
  fixture.recent = [];
  fixture.results = {};
  const html = screen();
  assert.deepEqual(
    fixture.requests.map((request) => request.queryKey[0]),
    ["home-mixes", "because-you-listened"],
  );
  assert.ok(fixture.requests.every((request) => request.enabled));
  assert.equal(fixture.radarEnabled, true);
  for (const feature of [
    "Charts",
    "Veröffentlichungen",
    "Genres",
    "Community-Playlists",
  ])
    assert.match(html, new RegExp(feature));
  assert.match(html, /href="\/genre"/);
  assert.match(html, /href="\/radio"/);
});

test("anonymous Home sends no personalized requests", () => {
  fixture.me = null;
  screen();
  assert.ok(fixture.requests.every((request) => !request.enabled));
  assert.equal(fixture.radarEnabled, false);
});

test("a failed personal mix remains explicit while real local history stays available", () => {
  fixture.me = { id: "user", display_name: "Alex" };
  fixture.recent = [
    {
      id: "track",
      title: "Mein letzter Titel",
      artist: "Mein Künstler",
      cover: "",
    },
  ];
  fixture.results = {
    "home-mixes": {
      data: undefined,
      error: new Error("Mixe: HTTP 503"),
      isError: true,
      isFetching: false,
      refetch: async () => {},
    },
  };
  const html = screen();
  assert.match(html, /Mixe: HTTP 503/);
  assert.match(html, /Mein letzter Titel/);
  assert.match(html, /Weiterhören/);
  assert.match(html, /Zuletzt gehört/);
});
