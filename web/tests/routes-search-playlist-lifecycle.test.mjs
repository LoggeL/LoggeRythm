import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const fixture = { owner: null, route: null, playlist: null };
globalThis.__searchPlaylistLifecycleFixture = fixture;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const nullComponent = moduleUrl("export default function Component() {return null;}");
const stubs = {
  react: moduleUrl(`
    export function useState(initial) {
      const owner = globalThis.__searchPlaylistLifecycleFixture.owner;
      const index = owner.cursor++;
      if (!(index in owner.hooks)) owner.hooks[index] = initial;
      return [owner.hooks[index], (value) => {owner.hooks[index] = typeof value === 'function' ? value(owner.hooks[index]) : value;}];
    }
    export function useRef(initial) {
      const owner = globalThis.__searchPlaylistLifecycleFixture.owner;
      const index = owner.cursor++;
      return owner.hooks[index] ??= {current: initial};
    }
    export function useMemo(callback) {return callback();}
    export function useLayoutEffect(callback, deps) {
      const owner = globalThis.__searchPlaylistLifecycleFixture.owner;
      const index = owner.cursor++;
      owner.nextEffects.push({index, callback, deps});
    }
  `),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": nullComponent,
  "@tanstack/react-query": moduleUrl(`export function useQuery(options) {
    const f = globalThis.__searchPlaylistLifecycleFixture;
    return {data: f.data[options.queryKey[1]] ?? [], isError: false, isLoading: false, isFetching: false, isSuccess: options.enabled};
  }`),
  "@/lib/catalogQueries": moduleUrl(`
    export const SEARCH_MIN_LENGTH = 2;
    const options = (entity) => (query) => ({queryKey: ['search', entity, query.trim()]});
    export const searchTracksOptions = options('track'); export const searchAlbumsOptions = options('album');
    export const searchArtistsOptions = options('artist'); export const searchPlaylistsOptions = options('playlist');
  `),
  "@/lib/api": moduleUrl(`export const api = {deezerPlaylist(id) {
    const f = globalThis.__searchPlaylistLifecycleFixture;
    f.requests.push(id);
    const response = f.responses.shift();
    if (!response) throw new Error('Missing deferred playlist response in fixture');
    return response;
  }};`),
  "@/store/player": moduleUrl("export const usePlayerStore = (selector) => selector(globalThis.__searchPlaylistLifecycleFixture.player); usePlayerStore.getState = () => globalThis.__searchPlaylistLifecycleFixture.player;"),
  "@/store/toast": moduleUrl("export const toast = {error: (message) => globalThis.__searchPlaylistLifecycleFixture.errors.push(message)};"),
  "@/hooks/useSearchNavigation": moduleUrl("export const useSearchNavigation = () => globalThis.__searchPlaylistLifecycleFixture.navigation;"),
  "@/hooks/useRecentSearches": moduleUrl("export const useRecentSearches = () => globalThis.__searchPlaylistLifecycleFixture.history;"),
  "@/hooks/usePlays": moduleUrl("export const useTrackPlays = () => ({});"),
  "@/components/TrackRow": nullComponent,
  "@/components/AlbumCard": nullComponent,
  "@/components/ArtistCard": nullComponent,
  "@/components/ImportPanel": nullComponent,
  "@/components/CoverPlaceholder": nullComponent,
  "@/components/Skeleton": moduleUrl("export function CardGridSkeleton() {return null;} export function RowListSkeleton() {return null;}"),
  "@/components/icons": moduleUrl("export function SearchIcon() {return null;} export const ImportIcon = SearchIcon; export const PlayIcon = SearchIcon; export const CompassIcon = SearchIcon; export const RadioIcon = SearchIcon;"),
  "./results": new URL("../src/app/search/results.ts", import.meta.url).href,
};
const source = await readFile(new URL("../src/app/search/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext},
}).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
  assert.ok(stubs[name], `Unmocked search route import: ${name}`);
  return `from ${JSON.stringify(stubs[name])}`;
});
const { default: SearchPage, PlaylistSearchResults } = await import(moduleUrl(compiled));

function owner(key) {return {key, hooks: [], effects: [], nextEffects: [], cursor: 0};}
function unmountOwner(instance) {
  for (const effect of instance?.effects ?? []) effect?.cleanup?.();
}
function unmountRoute() {
  unmountOwner(fixture.playlist);
  unmountOwner(fixture.route);
  fixture.playlist = null;
  fixture.route = null;
}
function renderOwner(instance, callback) {
  fixture.owner = instance;
  instance.cursor = 0;
  instance.nextEffects = [];
  const tree = callback();
  for (const effect of instance.nextEffects) {
    const previous = instance.effects[effect.index];
    if (previous && effect.deps.every((value, index) => Object.is(value, previous.deps[index]))) continue;
    previous?.cleanup?.();
    instance.effects[effect.index] = {...effect, cleanup: effect.callback()};
  }
  return tree;
}
function nodes(tree, predicate, found = []) {
  if (Array.isArray(tree)) {for (const child of tree) nodes(child, predicate, found); return found;}
  if (!tree || typeof tree !== "object") return found;
  if (predicate(tree)) found.push(tree);
  nodes(tree.props?.children, predicate, found);
  return found;
}
function renderRoute() {
  fixture.route ??= owner("route");
  const tree = renderOwner(fixture.route, () => SearchPage());
  const child = nodes(tree, (node) => node.type === PlaylistSearchResults)[0];
  if (!child || fixture.playlist?.key !== child.key) {
    unmountOwner(fixture.playlist);
    fixture.playlist = child ? owner(child.key) : null;
  }
  const resultTree = child ? renderOwner(fixture.playlist, () => PlaylistSearchResults(child.props)) : null;
  return {
    buttons: nodes(tree, (node) => node.type === "button").map((node) => node.props),
    playlists: nodes(resultTree, (node) => node.type === "button").map((node) => node.props),
  };
}
function setup() {
  unmountRoute();
  Object.assign(fixture, {
    data: {playlist: [{id: "mix", title: "Mix", cover: "", track_count: 1}]},
    requests: [], responses: [], played: [], remembered: [], errors: [],
    navigation: {input: "Queen", query: "Queen", tab: "playlist", sort: "relevance", preparing: false, setTab() {}, setSort() {}, openResults() {}},
    history: {recent: [], remember: (query) => fixture.remembered.push(query), remove() {}, clear() {}},
    player: {
      radioSession: 0,
      setRadioActive() {this.radioSession += 1;},
      playQueue: (tracks, index, title) => {fixture.player.radioSession += 1; fixture.played.push({tracks, index, title});},
    },
  });
}
function deferred() {
  let resolve;
  let reject;
  fixture.responses.push(new Promise((complete, fail) => {resolve = complete; reject = fail;}));
  return {resolve, reject};
}
const track = {id: "916424", title: "Without Me"};
const settle = () => new Promise(setImmediate);
function pendingStart() {
  setup();
  const response = deferred();
  const screen = renderRoute();
  screen.playlists[0].onClick();
  return {response, screen};
}

test("playlist history waits for successful play and double clicks remain locked", async () => {
  const {response, screen} = pendingStart();
  screen.playlists[0].onClick();
  assert.deepEqual(fixture.requests, ["mix"]);
  assert.deepEqual(fixture.remembered, []);
  assert.equal(renderRoute().playlists[0].disabled, true);
  response.resolve({tracks: [track]});
  await settle();
  assert.deepEqual(fixture.played, [{tracks: [track], index: 0, title: "Mix"}]);
  assert.deepEqual(fixture.remembered, ["Queen"]);
  assert.equal(renderRoute().playlists[0].disabled, false);
});

test("failed and empty playlists report their cause without recording history, then permit retry", async () => {
  for (const complete of [(response) => response.reject(new Error("HTTP 503")), (response) => response.resolve({tracks: []})]) {
    const {response} = pendingStart();
    complete(response);
    await settle();
    assert.equal(fixture.errors.length, 1);
    assert.match(fixture.errors[0], /HTTP 503|keine abspielbaren Titel/);
    assert.deepEqual(fixture.remembered, []);
    assert.deepEqual(fixture.played, []);
    const retry = deferred();
    renderRoute().playlists[0].onClick();
    retry.resolve({tracks: [track]});
    await settle();
    assert.equal(fixture.played.length, 1);
    assert.deepEqual(fixture.remembered, ["Queen"]);
  }
});

test("input, settled-query, clear, import and route exit each discard delayed playlist playback", async () => {
  for (const cancel of [
    () => {fixture.navigation.input = "new query"; fixture.navigation.preparing = true; renderRoute();},
    () => {fixture.navigation.input = "new query"; fixture.navigation.query = "new query"; renderRoute();},
    () => {fixture.navigation.input = ""; fixture.navigation.query = ""; renderRoute();},
    (screen) => {screen.buttons.find((button) => button["aria-controls"] === "search-import").onClick(); renderRoute();},
    () => unmountRoute(),
  ]) {
    const {response, screen} = pendingStart();
    cancel(screen);
    response.resolve({tracks: [track]});
    await settle();
    assert.deepEqual(fixture.played, []);
    assert.deepEqual(fixture.remembered, []);
    assert.deepEqual(fixture.errors, []);
  }
});

test("A to B to A creates a fresh request owner and cannot resurrect the old playlist", async () => {
  const {response, screen} = pendingStart();
  fixture.navigation.input = "Daft Punk";
  fixture.navigation.preparing = true;
  renderRoute();
  fixture.navigation.input = "Queen";
  fixture.navigation.preparing = false;
  const restored = renderRoute();
  screen.playlists[0].onClick();
  assert.deepEqual(fixture.requests, ["mix"], "detached buttons cannot start requests");
  const current = deferred();
  restored.playlists[0].onClick();
  response.resolve({tracks: [{id: "old"}]});
  await settle();
  assert.deepEqual(fixture.played, []);
  assert.deepEqual(fixture.remembered, []);
  assert.equal(renderRoute().playlists[0].disabled, true, "obsolete finally must not unlock the new owner");
  current.resolve({tracks: [track]});
  await settle();
  assert.deepEqual(fixture.played, [{tracks: [track], index: 0, title: "Mix"}]);
  assert.deepEqual(fixture.remembered, ["Queen"]);
});

test("new explicit playback retains priority over a delayed route playlist", async () => {
  const {response} = pendingStart();
  fixture.player.radioSession += 1;
  response.resolve({tracks: [track]});
  await settle();
  assert.deepEqual(fixture.played, []);
  assert.deepEqual(fixture.remembered, []);
});


test("a rejected playlist after newer playback cannot emit an obsolete failure", async () => {
  const {response} = pendingStart();
  fixture.player.radioSession += 1;
  response.reject(new Error("HTTP 503 from obsolete playlist"));
  await settle();
  assert.deepEqual(fixture.played, []);
  assert.deepEqual(fixture.remembered, []);
  assert.deepEqual(fixture.errors, []);
});
