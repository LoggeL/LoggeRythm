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
  navigation: null,
  history: null,
  navigationCalls: [],
  historyCalls: [],
  activations: [],
  trackRows: [],
  selects: [],
  retries: [],
  loading: [],
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
    `import * as runtime from ${JSON.stringify(import.meta.resolve("react/jsx-runtime"))}; export const Fragment = runtime.Fragment; function capture(type, props) { const fixture = globalThis.__searchScreenFixture; if(type === 'button') fixture.buttons.push(props); if(type === 'select') fixture.selects.push(props); if(props.onClickCapture) fixture.activations.push(props.onClickCapture); if(props.onAuxClickCapture) fixture.auxActivations.push(props.onAuxClickCapture); } export function jsx(type, props, key) { capture(type, props); return runtime.jsx(type, props, key); } export function jsxs(type, props, key) { capture(type, props); return runtime.jsxs(type, props, key); }`,
  ),
  "next/link": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, ...props}) { return createElement("a", {...props, href}, children); }`,
  ),
  "@tanstack/react-query": moduleUrl(
    `export function useQuery(options) { const fixture = globalThis.__searchScreenFixture; fixture.requests.push(options); const entity = options.queryKey[1]; const error = fixture.errors[entity]; const loading = fixture.loading.includes(entity); return {data: fixture.data[entity] ?? [], isError: !!error, error: error ? new Error(error) : null, isLoading: loading, isFetching: loading, isSuccess: options.enabled && !error && !loading, refetch: async () => {fixture.retries.push(entity);}}; }`,
  ),
  "@/lib/api": moduleUrl(
    "export const api = {deezerPlaylist(id) {const fixture = globalThis.__searchScreenFixture; fixture.playlistCalls.push(id); return fixture.pendingPlaylist;}};",
  ),
  "@/lib/catalogQueries": moduleUrl(
    `export const SEARCH_MIN_LENGTH = 2; const options = (entity) => (query) => ({queryKey: ['search', entity, query.trim()]}); export const searchTracksOptions = options('track'); export const searchAlbumsOptions = options('album'); export const searchArtistsOptions = options('artist'); export const searchPlaylistsOptions = options('playlist');`,
  ),
  "@/store/player": moduleUrl(
    "export const usePlayerStore = (selector) => selector(globalThis.__searchScreenFixture.player); usePlayerStore.getState = () => globalThis.__searchScreenFixture.player;",
  ),
  "@/store/toast": moduleUrl(
    "export const toast = {error(message) {globalThis.__searchScreenFixture.toasts.push(message);}};",
  ),
  "@/hooks/useSearchNavigation": moduleUrl(
    "export const useSearchNavigation = () => globalThis.__searchScreenFixture.navigation;",
  ),
  "@/hooks/useRecentSearches": moduleUrl(
    "export const useRecentSearches = () => globalThis.__searchScreenFixture.history;",
  ),
  "@/hooks/usePlays": moduleUrl(
    "export const useTrackPlays = (tracks) => {globalThis.__searchScreenFixture.plays = tracks; return {};};",
  ),
  "@/components/TrackRow": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function TrackRow(props) {globalThis.__searchScreenFixture.trackRows.push(props); return createElement('button', {className: 'track-row-play', onClick: props.onPlay}, props.track.title);}`,
  ),
  "@/components/AlbumCard": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function AlbumCard({album}) {return createElement('a', {href: '/album/' + album.id}, album.title);}`,
  ),
  "@/components/ArtistCard": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function ArtistCard({artist}) {return createElement('a', {href: '/artist/' + artist.id}, artist.name);}`,
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
  input,
  query = "",
  tab = "all",
  sort = "relevance",
  preparing = false,
  recent = [],
  loading = [],
  importing = false,
  data = {},
  errors = {},
} = {}) {
  fixture.stateIndex = 0;
  fixture.states = [importing, null];
  fixture.requests = [];
  fixture.data = data;
  fixture.errors = errors;
  fixture.plays = [];
  fixture.buttons = [];
  fixture.playlistCalls = [];
  fixture.played = [];
  fixture.toasts = [];
  fixture.loading = loading;
  fixture.selects = [];
  fixture.activations = [];
  fixture.auxActivations = [];
  fixture.trackRows = [];
  fixture.navigationCalls = [];
  fixture.historyCalls = [];
  fixture.retries = [];
  fixture.navigation = {
    input: input ?? query, query, tab, sort, preparing,
    setTab: (value) => fixture.navigationCalls.push(["tab", value]),
    setSort: (value) => fixture.navigationCalls.push(["sort", value]),
    openResults: (value) => fixture.navigationCalls.push(["open", value]),
  };
  fixture.history = {
    recent,
    remember: (value) => fixture.historyCalls.push(["remember", value]),
    remove: (value) => fixture.historyCalls.push(["remove", value]),
    clear: () => fixture.historyCalls.push(["clear"]),
  };
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
  assert.doesNotMatch(html, /<input|role="search"/);
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
  const buttons = fixture.buttons.filter((button) => button.className?.includes("music-card"));
  assert.equal(buttons.length, 1);
  return { click: buttons[0].onClick, resolve };
}

test("playlist starts reserve one request before React rerenders", async () => {
  const { click, resolve } = playlistScreen();
  click();
  click();
  assert.deepEqual(fixture.playlistCalls, ["mix"]);
  assert.deepEqual(fixture.historyCalls, []);
  const tracks = [{ id: "song", title: "Song" }];
  resolve({ tracks });
  await new Promise(setImmediate);
  assert.deepEqual(fixture.played, [{ tracks, index: 0, title: "Mein Mix" }]);
  assert.deepEqual(fixture.historyCalls, [["remember", "Mix"]]);
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
  assert.deepEqual(fixture.historyCalls, []);
  assert.match(
    fixture.toasts[0],
    /Diese Playlist enthält keine abspielbaren Titel/,
  );
});


function buttonWithText(text) {
  return fixture.buttons.find((button) => button.children === text);
}

const songs = [
  { id: "one", title: "Zulu", duration_sec: 300 },
  { id: "two", title: "Alpha", duration_sec: 120 },
];

test("one-character search cannot send catalog or play-count requests", () => {
  const html = screen({ query: "A", data: { track: songs } });
  assert.deepEqual(requestedEntities(), []);
  assert.deepEqual(fixture.plays, []);
  assert.equal(fixture.trackRows.length, 0);
  assert.match(html, /Mindestens 2 Zeichen/);
});

test("editing immediately removes old actionable results until the shared query settles", () => {
  const html = screen({
    input: "new artist", query: "old artist", preparing: true,
    data: {
      track: songs,
      artist: [{ id: "artist", name: "Cached Artist" }],
      playlist: [{ id: "mix", title: "Cached Playlist", track_count: 2 }],
    },
  });
  assert.deepEqual(requestedEntities(), []);
  assert.deepEqual(fixture.plays, []);
  assert.equal(fixture.trackRows.length, 0);
  assert.equal(fixture.activations.length, 0);
  assert.doesNotMatch(html, /Cached Artist|Cached Playlist|Zulu|Alpha/);
  assert.match(html, /aria-busy="true"/);
});

test("category and sort controls use shared navigation and display the chosen sort", () => {
  const html = screen({ query: "Songs", tab: "track", sort: "title", data: { track: songs } });
  assert.deepEqual(fixture.trackRows.map(({ track }) => track.id), ["two", "one"]);
  assert.match(html, /value="title" selected=""/);
  assert.doesNotMatch(html, /<h2[^>]*>Titel/);
  buttonWithText("Künstler").onClick();
  fixture.selects[0].onChange({ target: { value: "dur-desc" } });
  assert.deepEqual(fixture.navigationCalls, [["tab", "artist"], ["sort", "dur-desc"]]);
  assert.deepEqual(fixture.historyCalls, []);
});

test("recent terms reopen shared search and can be removed individually", () => {
  const html = screen({ recent: ["Artist", "Album"] });
  assert.match(html, /Zuletzt gesucht/);
  assert.deepEqual(fixture.historyCalls, []);
  const term = fixture.buttons.find((button) => Array.isArray(button.children) && button.children.some((child) => child?.props?.children === "Artist"));
  term.onClick();
  fixture.buttons.find((button) => button["aria-label"] === "Aus Suchverlauf entfernen: Album").onClick();
  buttonWithText("Verlauf löschen").onClick();
  assert.deepEqual(fixture.navigationCalls, [["open", "Artist"]]);
  assert.deepEqual(fixture.historyCalls, [["remove", "Album"], ["clear"]]);
});

test("only actual result links or playback add the settled search to history", () => {
  screen({ query: "Artist", data: { track: songs, artist: [{ id: "artist", name: "Artist" }], album: [{ id: "album", title: "Album" }] } });
  assert.deepEqual(fixture.historyCalls, []);
  const click = (matches) => ({ button: 0, target: { closest: () => matches ? { tagName: "A" } : null } });
  fixture.activations[0](click(false));
  assert.deepEqual(fixture.historyCalls, []);
  fixture.activations[0](click(true));
  fixture.activations[2](click(true));
  fixture.activations[3](click(true));
  assert.deepEqual(fixture.historyCalls, [["remember", "Artist"], ["remember", "Artist"], ["remember", "Artist"]]);
});

test("failed search can retry while the empty state only follows successful empty requests", async () => {
  const failed = screen({ query: "Missing", tab: "artist", errors: { artist: "HTTP 503" } });
  assert.doesNotMatch(failed, /Keine Ergebnisse/);
  buttonWithText("Erneut versuchen").onClick();
  await new Promise(setImmediate);
  assert.deepEqual(fixture.retries, ["artist"]);
  const completed = screen({ query: "Missing" });
  assert.match(completed, /Keine Ergebnisse/);
  const pending = screen({ query: "Missing", loading: ["playlist"] });
  assert.doesNotMatch(pending, /Keine Ergebnisse/);
});


test("search announces a settled count to screen readers without extra visible copy", () => {
  const html = screen({ query: "Songs", tab: "track", data: { track: songs } });
  assert.match(html, /role="status" aria-live="polite" class="sr-only">2 Ergebnisse/);
});


test("result history includes menu selection and middle-click links, while right-click only opens options", () => {
  screen({ query: "Songs", tab: "track", data: { track: songs } });
  const click = (button, tagName) => ({ button, target: { closest: () => ({ tagName }) } });
  fixture.activations[0](click(0, "BUTTON"));
  fixture.auxActivations[0](click(1, "A"));
  fixture.auxActivations[0](click(1, "BUTTON"));
  fixture.auxActivations[0](click(2, "A"));
  assert.deepEqual(fixture.historyCalls, [["remember", "Songs"], ["remember", "Songs"]]);
});
