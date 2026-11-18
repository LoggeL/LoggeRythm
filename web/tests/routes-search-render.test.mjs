import assert from "node:assert/strict";
import test from "node:test";
import { compileInto, compileSource } from "./support/compile.mjs";
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
  played: [],
  toasts: [],
  player: null,
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
  // The library index is the real one, built from the fixture's saved songs.
  "@/lib/libraryMatch": new URL("../src/lib/libraryMatch.ts", import.meta.url).href,
  "@/hooks/useLibraryTracks": moduleUrl(
    `import {indexLibraryTracks} from ${JSON.stringify(new URL("../src/lib/libraryMatch.ts", import.meta.url).href)}; export const useLibraryTracks = () => { const fixture = globalThis.__searchScreenFixture; return {index: indexLibraryTracks(fixture.library), likes: fixture.likes}; };`,
  ),
  "@/components/TrackRow": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function TrackRow(props) {globalThis.__searchScreenFixture.trackRows.push(props); return createElement('button', {className: 'track-row-play', onClick: props.onPlay}, props.track.title);}`,
  ),
  "@/components/AlbumCard": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function AlbumCard({album}) {return createElement('a', {href: '/album/' + album.id}, album.title);}`,
  ),
  "@/components/DeezerPlaylistCard": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function DeezerPlaylistCard({playlist}) {return createElement('article', null, createElement('a', {href: '/deezer-playlist/' + playlist.id}, playlist.title), createElement('button', {type: 'button', 'aria-label': playlist.title + ' abspielen'}), createElement('p', null, 'Playlist · ' + playlist.track_count + ' Titel'));}`,
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
    "export function SearchIcon() {return null;} export const ImportIcon = SearchIcon; export const PlayIcon = SearchIcon; export const CompassIcon = SearchIcon; export const RadioIcon = SearchIcon; export const BellIcon = SearchIcon; export const CloseIcon = SearchIcon; export const HeartIcon = SearchIcon;",
  ),
  "@/lib/trackArtists": moduleUrl(
    "export const trackArtistLabel = (track) => track.artist;",
  ),
  // A shelf needs a browser to measure; the stub keeps its cards as children.
  "@/components/browse/Shelf": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Shelf({label, children}) { return createElement('div', {'data-shelf': label}, children); } export function ShelfSkeleton() { return null; }`,
  ),
  "./results": new URL("../src/app/search/results.ts", import.meta.url).href,
  "../results": new URL("../src/app/search/results.ts", import.meta.url).href,
};
// The page's own sections and the shared primitives are the real components,
// compiled against the same stubs so their buttons and handlers are captured.
await compileInto(stubs, [
  ["@/components/ui/Cover", "src/components/ui/Cover.tsx"],
  ["@/components/ui/EmptyState", "src/components/ui/EmptyState.tsx"],
  ["@/components/ui/QueryError", "src/components/ui/QueryError.tsx"],
  ["@/components/browse/BrowseTile", "src/components/browse/BrowseTile.tsx"],
  ["./ResultCards", "src/app/search/_components/ResultCards.tsx"],
  ["./_components/ResultCards", "src/app/search/_components/ResultCards.tsx"],
  ["./_components/SearchFilters", "src/app/search/_components/SearchFilters.tsx"],
  ["./_components/SearchIdle", "src/app/search/_components/SearchIdle.tsx"],
  ["./_components/ResultSection", "src/app/search/_components/ResultSection.tsx"],
  ["./_components/TopHit", "src/app/search/_components/TopHit.tsx"],
  ["./_components/TrackResults", "src/app/search/_components/TrackResults.tsx"],
  ["./_components/LibraryResults", "src/app/search/_components/LibraryResults.tsx"],
  ["./_components/ArtistResults", "src/app/search/_components/ArtistResults.tsx"],
  ["./_components/AlbumResults", "src/app/search/_components/AlbumResults.tsx"],
  ["./_components/PlaylistResults", "src/app/search/_components/PlaylistResults.tsx"],
]);
const { default: SearchPage } = await import(
  await compileSource("src/app/search/page.tsx", stubs),
);

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
  library = [],
  likesError = null,
} = {}) {
  fixture.stateIndex = 0;
  fixture.states = [importing, null];
  fixture.requests = [];
  fixture.data = data;
  fixture.errors = errors;
  fixture.plays = [];
  fixture.buttons = [];
  fixture.played = [];
  fixture.toasts = [];
  fixture.loading = loading;
  fixture.library = library;
  fixture.likes = {
    isError: !!likesError,
    error: likesError ? new Error(likesError) : null,
    isFetching: false,
    refetch: async () => {
      fixture.retries.push("likes");
    },
  };
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

test("playlist results open their detail page and only the play button starts them", () => {
  const html = screen({
    query: "Mix",
    tab: "playlist",
    data: {
      playlist: [{ id: "mix", title: "Mein Mix", cover: "", track_count: 2 }],
    },
  });
  assert.match(html, /href="\/deezer-playlist\/mix"/);
  assert.match(html, /Mein Mix abspielen/);
  assert.match(html, /Playlist · 2 Titel/);
  assert.deepEqual(fixture.played, []);
  assert.equal(fixture.activations.length, 1, "the card records the search once it is used");
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
  screen({ query: "Songs", data: { track: songs, artist: [{ id: "artist", name: "Artist" }], album: [{ id: "album", title: "Album" }] } });
  assert.deepEqual(fixture.historyCalls, []);
  const click = (matches) => ({ button: 0, target: { closest: () => matches ? { tagName: "A" } : null } });
  fixture.activations[0](click(false));
  assert.deepEqual(fixture.historyCalls, []);
  fixture.activations[0](click(true));
  fixture.activations[2](click(true));
  fixture.activations[3](click(true));
  assert.deepEqual(fixture.historyCalls, [["remember", "Songs"], ["remember", "Songs"], ["remember", "Songs"]]);
});

test("starting a result records the search however playback was triggered", () => {
  // Row play button, desktop double-click and the top-hit card all go through
  // the row's/card's play callback rather than a recognisable click target.
  screen({ query: "Zulu", data: { track: songs } });
  fixture.trackRows[0].onPlay();
  assert.deepEqual(fixture.played.map(({ index, title }) => [index, title]), [[0, "Suche: Zulu"]]);
  assert.deepEqual(fixture.historyCalls, [["remember", "Zulu"]]);
  const topHit = fixture.buttons.find((button) => button["aria-label"] === "Zulu von undefined abspielen");
  assert.ok(topHit, "the top-hit track card is rendered");
  topHit.onClick();
  assert.equal(fixture.played.length, 2);
  assert.deepEqual(fixture.historyCalls, [["remember", "Zulu"], ["remember", "Zulu"]]);
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

test("the combined view features a top hit beside the best tracks and previews other types as shelves", () => {
  const html = screen({
    query: "Zulu",
    data: {
      track: Array.from({ length: 6 }, (_, index) => ({ id: `t${index}`, title: `Zulu ${index}`, artist: "Band", duration_sec: 100 })),
      artist: [{ id: "artist", name: "Andere Band" }],
      playlist: [{ id: "mix", title: "Zulu Mix", cover: "", track_count: 2 }],
    },
  });
  assert.match(html, /<h2>Top-Treffer<\/h2>/);
  assert.equal(fixture.trackRows.length, 4);
  assert.match(html, /aria-label="Zulu 0 von Band abspielen"/);
  assert.match(html, /data-shelf="Künstler"/);
  assert.match(html, /data-shelf="Playlists"/);
  fixture.buttons.find((button) => button["aria-label"] === "Zulu 0 von Band abspielen").onClick();
  assert.equal(fixture.played[0].index, 0);
  assert.equal(fixture.played[0].title, "Suche: Zulu");
  buttonWithText("Alle anzeigen").onClick();
  assert.deepEqual(fixture.navigationCalls, [["tab", "track"]]);
});

test("an artist whose name starts with the query becomes the top hit and counts as a used result", () => {
  const html = screen({ query: "Que", data: { track: songs, artist: [{ id: "queen", name: "Queen" }] } });
  assert.match(html, /<a[^>]*href="\/artist\/queen"[^>]*>.*?Queen/);
  assert.doesNotMatch(html, /data-shelf="Künstler"/, "the featured artist is not listed a second time");
  assert.equal(fixture.activations.length, 2, "only the two track rows remain as result wrappers");
  assert.doesNotMatch(screen({ query: "Songs", tab: "track", data: { track: songs } }), /Top-Treffer/);
});

test("the empty search shows its heading, browsing tiles and the Spotify import entry", () => {
  const html = screen();
  assert.match(html, /<h1 class="page-title[^"]*">Suche<\/h1>/);
  assert.doesNotMatch(html, /aria-label="Suchbereiche"/);
  for (const href of ["/genre", "/radio", "/radar"]) assert.ok(html.includes(`href="${href}"`));
  assert.equal(fixture.buttons.filter((button) => button["aria-controls"] === "search-import").length, 1);
  assert.match(html, /Playlist per Link übernehmen/);
});

const saved = [
  { id: "s1", title: "Zulu Dawn", artist: "Band", album: "Saved", duration_sec: 200 },
  { id: "s2", title: "Other", artist: "Zulu Choir", album: "Saved", duration_sec: 210 },
  { id: "s3", title: "Unrelated", artist: "Nobody", album: "Saved", duration_sec: 220 },
];
const rowIds = () => fixture.trackRows.map(({ track }) => track.id);

test("saved songs matching the typed text show before the catalog search has even started", () => {
  const html = screen({ input: "zulu", query: "", preparing: true, library: saved });
  assert.deepEqual(requestedEntities(), [], "no catalog request while the input settles");
  assert.deepEqual(fixture.plays, [], "library rows request no play counts");
  assert.match(html, /<section aria-label="In deiner Bibliothek"[^>]*>.*?<h2>In deiner Bibliothek<\/h2>/);
  assert.deepEqual(rowIds(), ["s1", "s2"]);
  assert.ok(html.indexOf("In deiner Bibliothek") < html.indexOf('aria-busy="true"'), "the loading placeholder stays below the library");
});

test("the library follows the input on every keystroke, not the settled query", () => {
  screen({ input: "zulu da", query: "zulu", preparing: true, library: saved, data: { track: songs } });
  assert.deepEqual(rowIds(), ["s1"]);
  assert.doesNotMatch(screen({ input: "z", query: "zulu", preparing: true, library: saved }), /In deiner Bibliothek/);
  assert.doesNotMatch(screen({ input: "xyz", query: "xyz", library: saved }), /In deiner Bibliothek/);
});

test("the library stays while the catalog loads and when it fails", () => {
  const loading = screen({ query: "zulu", library: saved, loading: ["track", "artist"] });
  assert.match(loading, /In deiner Bibliothek/);
  assert.deepEqual(rowIds(), ["s1", "s2"]);
  const failed = screen({ query: "zulu", library: saved, errors: { track: "HTTP 503" } });
  assert.match(failed, /Titel konnten nicht geladen werden: HTTP 503/);
  assert.deepEqual(rowIds(), ["s1", "s2"]);
  assert.ok(failed.indexOf("In deiner Bibliothek") < failed.indexOf('role="alert"'), "the failure is reported below the library");
});

test("a library song is not listed again among the catalog songs, and each list plays as its own queue", () => {
  const catalog = [
    { id: "c1", title: "Zulu", artist: "Band", duration_sec: 100 },
    { id: "s1", title: "Zulu Dawn", artist: "Band", duration_sec: 200 },
    { id: "c2", title: "Zulu Two", artist: "Band", duration_sec: 100 },
    { id: "c3", title: "Zulu Three", artist: "Band", duration_sec: 100 },
  ];
  const html = screen({ query: "zulu", library: saved, data: { track: catalog } });
  assert.deepEqual(rowIds(), ["s1", "s2", "c1", "c2", "c3"]);
  assert.doesNotMatch(html, /Keine Ergebnisse/);
  fixture.trackRows[3].onPlay();
  assert.deepEqual(fixture.played[0].tracks.map(({ id }) => id), ["c1", "c2", "c3"]);
  assert.equal(fixture.played[0].index, 1);
  assert.equal(fixture.played[0].title, "Suche: zulu");
  fixture.trackRows[1].onPlay();
  assert.deepEqual(fixture.played[1].tracks.map(({ id }) => id), ["s1", "s2"]);
  assert.equal(fixture.played[1].index, 1);
  assert.equal(fixture.played[1].title, "Bibliothek: zulu");
  assert.deepEqual(fixture.historyCalls, [["remember", "zulu"], ["remember", "zulu"]]);
});

test("the top hit stays the best catalog match even when the library lists that song", () => {
  const catalog = [
    { id: "s1", title: "Zulu Dawn", artist: "Band", duration_sec: 200 },
    { id: "c1", title: "Zulu", artist: "Band", duration_sec: 100 },
  ];
  screen({ query: "zulu", library: saved, data: { track: catalog } });
  assert.deepEqual(rowIds(), ["s1", "s2", "c1"]);
  fixture.buttons.find((button) => button["aria-label"] === "Zulu Dawn von Band abspielen").onClick();
  assert.deepEqual(fixture.played[0].tracks.map(({ id }) => id), ["s1", "c1"]);
  assert.equal(fixture.played[0].index, 0);
});

test("the library previews five songs in the combined view, ten in the songs filter, and no other filter shows it", () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, title: `Zulu ${index}`, artist: "Band", album: "Saved", duration_sec: 100 }));
  screen({ query: "zulu", library: many });
  assert.equal(fixture.trackRows.length, 5);
  fixture.trackRows[4].onPlay();
  assert.equal(fixture.played[0].tracks.length, 12, "playing continues through every match");
  const filtered = screen({ query: "zulu", tab: "track", library: many, data: { track: songs } });
  assert.deepEqual(rowIds(), [...many.slice(0, 10).map(({ id }) => id), "one", "two"]);
  assert.match(filtered, /<h2>Weitere Titel<\/h2>/);
  assert.doesNotMatch(screen({ query: "zulu", tab: "album", library: many }), /In deiner Bibliothek/);
  assert.doesNotMatch(screen({ query: "zulu", importing: true, library: many }), /In deiner Bibliothek/);
});

test("using a library row before the query settles records the typed text", () => {
  screen({ input: " zulu ", query: "zu", preparing: true, library: saved });
  fixture.activations[0]({ button: 0, target: { closest: () => ({ tagName: "A" }) } });
  fixture.activations[0]({ button: 0, target: { closest: () => null } });
  fixture.auxActivations[0]({ button: 2, target: { closest: () => ({ tagName: "A" }) } });
  assert.deepEqual(fixture.historyCalls, [["remember", " zulu "]]);
});

test("a failed liked-songs request is reported where the library would be, with a retry", async () => {
  const html = screen({ query: "zulu", likesError: "HTTP 500" });
  assert.match(html, /Lieblingssongs konnten nicht geladen werden: HTTP 500/);
  buttonWithText("Erneut versuchen").onClick();
  await new Promise(setImmediate);
  assert.deepEqual(fixture.retries, ["likes"]);
  assert.doesNotMatch(screen({ likesError: "HTTP 500" }), /Lieblingssongs konnten nicht geladen/, "nothing to report before a search");
});
