import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = {
  stateIndex: 0,
  states: [],
  requests: [],
  plays: [],
  data: {},
  errors: {},
  buttons: [],
  playlistCalls: [],
  played: [],
  toasts: [],
  player: null,
  pendingPlaylist: null,
};
globalThis.__searchScreenFixture = fixture;
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = import.meta.resolve("react");
const nullComponent = moduleUrl(
  "export default function Component() { return null; }",
);
const stubs = {
  react: moduleUrl(
    `import * as React from ${JSON.stringify(reactUrl)}; export * from ${JSON.stringify(reactUrl)}; export function useState(initial) { const fixture = globalThis.__searchScreenFixture; const index = fixture.stateIndex++; return React.useState(index in fixture.states ? fixture.states[index] : initial); }`,
  ),
  "react/jsx-runtime": moduleUrl(
    `import * as runtime from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}; export const Fragment = runtime.Fragment; function capture(type, props) { if(type === 'button' && props.className?.includes('music-card')) globalThis.__searchScreenFixture.buttons.push(props); } export function jsx(type, props, key) { capture(type, props); return runtime.jsx(type, props, key); } export function jsxs(type, props, key) { capture(type, props); return runtime.jsxs(type, props, key); }`,
  ),
  "next/link": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, ...props}) { return createElement("a", {...props, href}, children); }`,
  ),
  "@tanstack/react-query": moduleUrl(
    `export function useQuery(options) { const fixture = globalThis.__searchScreenFixture; fixture.requests.push(options); const entity = options.queryKey[1]; const error = fixture.errors[entity]; return {data: fixture.data[entity] ?? [], isError: !!error, error: error ? new Error(error) : null, isLoading: false, isFetching: false, isSuccess: options.enabled && !error, refetch: async () => {}}; }`,
  ),
  "@/lib/api": moduleUrl(
    "export const api = {deezerPlaylist(id) {const fixture = globalThis.__searchScreenFixture; fixture.playlistCalls.push(id); return fixture.pendingPlaylist;}};",
  ),
  "@/lib/catalogQueries": moduleUrl(
    `export const SEARCH_DEBOUNCE_MS = 250; const options = (entity) => (query) => ({queryKey: ['search', entity, query.trim()]}); export const searchTracksOptions = options('track'); export const searchAlbumsOptions = options('album'); export const searchArtistsOptions = options('artist'); export const searchPlaylistsOptions = options('playlist');`,
  ),
  "@/store/player": moduleUrl(
    "export const usePlayerStore = (selector) => selector(globalThis.__searchScreenFixture.player); usePlayerStore.getState = () => globalThis.__searchScreenFixture.player;",
  ),
  "@/store/toast": moduleUrl(
    "export const toast = {error(message) {globalThis.__searchScreenFixture.toasts.push(message);}};",
  ),
  "@/hooks/useLocalJson": moduleUrl(
    "export const useLocalJson = () => [[], () => {}];",
  ),
  "@/hooks/usePlays": moduleUrl(
    "export const useTrackPlays = (tracks) => {globalThis.__searchScreenFixture.plays = tracks; return {};};",
  ),
  "@/components/TrackRow": nullComponent,
  "@/components/AlbumCard": nullComponent,
  "@/components/ArtistCard": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function ArtistCard({artist}) {return createElement('p', null, artist.name);}`,
  ),
  "@/components/ImportPanel": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function ImportPanel() {return createElement('p', null, 'Importformular');}`,
  ),
  "@/components/CoverPlaceholder": nullComponent,
  "@/components/Skeleton": moduleUrl(
    "export function CardGridSkeleton() { return null; } export function RowListSkeleton() { return null; }",
  ),
  "@/components/icons": moduleUrl(
    "export function SearchIcon() {return null;} export const ImportIcon = SearchIcon; export const PlayIcon = SearchIcon; export const CompassIcon = SearchIcon; export const RadioIcon = SearchIcon;",
  ),
  "./history": new URL("../src/app/search/history.ts", import.meta.url).href,
  "./results": new URL("../src/app/search/results.ts", import.meta.url).href,
};
const source = await readFile(
  new URL("../src/app/search/page.tsx", import.meta.url),
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
const { default: SearchPage } = await import(moduleUrl(compiled));

function screen({
  query = "",
  tab = "all",
  importing = false,
  data = {},
  errors = {},
} = {}) {
  fixture.stateIndex = 0;
  fixture.states = [query, query, tab, "relevance", importing, null];
  fixture.requests = [];
  fixture.data = data;
  fixture.errors = errors;
  fixture.plays = [];
  fixture.buttons = [];
  fixture.playlistCalls = [];
  fixture.played = [];
  fixture.toasts = [];
  fixture.player = {
    radioSession: 0,
    setRadioActive() {
      this.radioSession += 1;
    },
    playQueue: (tracks, index, title) =>
      fixture.played.push({ tracks, index, title }),
  };
  return renderToStaticMarkup(createElement(SearchPage));
}

function requestedEntities() {
  return fixture.requests
    .filter((request) => request.enabled)
    .map((request) => request.queryKey[1]);
}

test("empty search makes no catalog requests and directs browsing to Discover", () => {
  const html = screen();
  assert.deepEqual(requestedEntities(), []);
  assert.equal(fixture.requests.length, 4);
  assert.match(html, /role="search"/);
  assert.match(html, /href="\/genre"/);
  assert.match(html, /href="\/radio"/);
});

test("search fetches just the selected entity while All includes each entity", () => {
  screen({ query: "Artist", tab: "artist" });
  assert.deepEqual(requestedEntities(), ["artist"]);
  assert.deepEqual(fixture.plays, []);
  screen({ query: "Artist" });
  assert.deepEqual(requestedEntities(), [
    "track",
    "album",
    "artist",
    "playlist",
  ]);
});

test("Spotify import disables hidden catalog requests and hides cached search results", () => {
  const html = screen({
    query: "Artist",
    importing: true,
    data: { artist: [{ id: "artist", name: "Cached Artist" }] },
  });
  assert.deepEqual(requestedEntities(), []);
  assert.deepEqual(fixture.plays, []);
  assert.match(html, /Importformular/);
  assert.doesNotMatch(html, /Cached Artist/);
});

test("failed search displays the actual cause instead of a no-results state", () => {
  const html = screen({
    query: "Artist",
    tab: "artist",
    errors: { artist: "Künstlersuche: HTTP 503" },
  });
  assert.match(html, /role="alert"/);
  assert.match(html, /Künstlersuche: HTTP 503/);
  assert.match(html, /Erneut versuchen/);
  assert.doesNotMatch(html, /Keine Ergebnisse/);
});

function playlistScreen() {
  screen({
    query: "Mix",
    tab: "playlist",
    data: {
      playlist: [{ id: "mix", title: "Mein Mix", cover: "", track_count: 2 }],
    },
  });
  let resolve;
  fixture.pendingPlaylist = new Promise((complete) => {
    resolve = complete;
  });
  assert.equal(fixture.buttons.length, 1);
  return { click: fixture.buttons[0].onClick, resolve };
}

test("playlist starts reserve one request before React rerenders", async () => {
  const { click, resolve } = playlistScreen();
  click();
  click();
  assert.deepEqual(fixture.playlistCalls, ["mix"]);
  const tracks = [{ id: "song", title: "Song" }];
  resolve({ tracks });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.played, [{ tracks, index: 0, title: "Mein Mix" }]);
});

test("a pending search playlist cannot replace a newer explicit playback choice", async () => {
  const { click, resolve } = playlistScreen();
  click();
  fixture.player.radioSession += 1;
  resolve({ tracks: [{ id: "old-playlist-song" }] });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.played, []);
});

test("empty playlist responses stay loud and never start an empty queue", async () => {
  const { click, resolve } = playlistScreen();
  click();
  resolve({ tracks: [] });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.played, []);
  assert.match(
    fixture.toasts[0],
    /Diese Playlist enthält keine abspielbaren Titel/,
  );
});
