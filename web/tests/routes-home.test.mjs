import assert from "node:assert/strict";
import test from "node:test";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = {
  me: { id: "user", display_name: "Alex" },
  recent: [],
  requests: [],
  results: {},
  radarEnabled: false,
  radar: [],
};
globalThis.__homeScreenFixture = fixture;
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
    "export const useReleaseRadar = (me) => {globalThis.__homeScreenFixture.radarEnabled = !!me; return {data: globalThis.__homeScreenFixture.radar, isSuccess: true};}; export const useReleaseRadarSeen = (_id, tracks) => ({unseenCount: tracks.length});",
  ),
  "@/lib/trackArtists": moduleUrl(
    "export const trackArtistLabel = (track) => track.artist;",
  ),
  "@/components/icons": moduleUrl(
    "export function PlayIcon() {return null;} export const RadioIcon = PlayIcon; export const CompassIcon = PlayIcon; export const ChevronLeftIcon = PlayIcon; export const ChevronRightIcon = PlayIcon;",
  ),
  "@/components/CoverPlaceholder": empty,
  "@/components/ShelfCard": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function ShelfCard({shelf, statusBadge}) {return createElement('p', null, shelf.title, statusBadge ? ' [' + statusBadge + ']' : '');}`,
  ),
};
// The shared primitives and the history hook are the real implementations.
await compileInto(stubs, [
  ["@/hooks/useRecentTracks", "src/hooks/useRecentTracks.ts"],
  ["@/components/ui/Cover", "src/components/ui/Cover.tsx"],
  ["@/components/ui/QueryError", "src/components/ui/QueryError.tsx"],
  ["@/components/ui/EmptyState", "src/components/ui/EmptyState.tsx"],
  ["@/components/ui/SectionHeader", "src/components/ui/SectionHeader.tsx"],
  ["@/components/browse/Shelf", "src/components/browse/Shelf.tsx"],
  ["@/components/browse/QuickTile", "src/components/browse/QuickTile.tsx"],
  ["@/components/browse/BrowseTile", "src/components/browse/BrowseTile.tsx"],
  ["@/components/browse/QueryState", "src/components/browse/QueryState.tsx"],
]);
const { default: HomePage } = await import(
  await compileSource("src/app/page.tsx", stubs)
);
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
    "Playlists",
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

test("recent tiles, shelves and the release radar badge render without the old hero card", () => {
  fixture.me = { id: "user", display_name: "Alex" };
  fixture.recent = Array.from({ length: 8 }, (_, index) => ({
    id: `track-${index}`,
    title: `Titel ${index}`,
    artist: "Künstler",
    cover: "",
  }));
  fixture.radar = [{ id: "new", title: "Neu", artist: "Künstler", cover: "" }];
  fixture.results = {
    "home-mixes": {
      data: [{ key: "weekly", title: "Mix der Woche", tracks: [] }],
      isSuccess: true,
      isError: false,
      isLoading: false,
    },
  };
  const html = screen();
  fixture.radar = [];
  assert.equal(html.match(/aria-label="Titel \d von Künstler abspielen"/g).length, 6);
  assert.match(html, /Dein Release Radar \[1 neu\]/);
  assert.match(html, /Mix der Woche/);
  assert.match(html, /<ul aria-label="Für dich zusammengestellt"/);
  assert.match(html, /href="\/library\?tab=recent"/);
});

test("personal shelves show a skeleton while loading and a next step when empty", () => {
  fixture.me = { id: "user", display_name: "Alex" };
  fixture.recent = [];
  fixture.results = {
    "home-mixes": { data: undefined, isLoading: true, isError: false },
  };
  const loading = screen();
  assert.match(loading, /role="status" aria-label="Persönliche Musik wird geladen"/);
  assert.doesNotMatch(loading, /Deine Mixe entstehen beim Hören/);
  fixture.results = {};
  assert.match(screen(), /Deine Mixe entstehen beim Hören/);
});
