import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const fixture = { hooks: [], effects: [], cursor: 0, nextEffects: [] };
globalThis.__paletteFixture = fixture;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const stubs = {
  react: moduleUrl(`
    export function useRef(value) { const f = globalThis.__paletteFixture; const index = f.cursor++; return f.hooks[index] ??= {current: value}; }
    export function useId() { return useRef('palette-list').current; }
    export function useState(initial) { const f = globalThis.__paletteFixture; const index = f.cursor++; if (!(index in f.hooks)) f.hooks[index] = initial; return [f.hooks[index], (value) => {f.hooks[index] = typeof value === 'function' ? value(f.hooks[index]) : value;}]; }
    export function useEffect(callback, deps) { const f = globalThis.__paletteFixture; const index = f.cursor++; f.nextEffects.push({index, callback, deps}); }
  `),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/navigation": moduleUrl("export function useRouter() {return {push: (url) => globalThis.__paletteFixture.routes.push(url)};}"),
  "@tanstack/react-query": moduleUrl(`export function useQuery(options) {
    const f = globalThis.__paletteFixture; f.requests.push(options);
    const entity = options.queryKey[1]; const error = f.errors[entity];
    return {data: f.data[entity], isError: !!error, error: error ? new Error(error) : null, isFetching: !!f.fetching[entity], isSuccess: options.enabled && !error && !!f.data[entity], refetch: () => {f.retries.push(entity);}};
  }`),
  "@/lib/catalogQueries": moduleUrl(`
    export const SEARCH_MIN_LENGTH = 2;
    export const normalizeCatalogQuery = (value) => value.trim();
    const options = (entity) => (query) => ({queryKey: ['search', entity, query.trim()]});
    export const searchTracksOptions = options('track'); export const searchArtistsOptions = options('artist');
    export const searchAlbumsOptions = options('album'); export const searchPlaylistsOptions = options('playlist');
  `),
  "@/lib/api": moduleUrl("export const api = {deezerPlaylist(id) {const f = globalThis.__paletteFixture; f.playlistCalls.push(id); return f.pendingPlaylist;}};"),
  "@/lib/trackArtists": new URL("../src/lib/trackArtists.ts", import.meta.url).href,
  "@/store/player": moduleUrl("export const usePlayerStore = (selector) => selector(globalThis.__paletteFixture.player); usePlayerStore.getState = () => globalThis.__paletteFixture.player;"),
  "@/components/icons": moduleUrl("export function SearchIcon() {return null;} export const CloseIcon = SearchIcon; export const PlayIcon = SearchIcon;"),
  "@/components/CoverPlaceholder": moduleUrl("export default function CoverPlaceholder() {return null;}"),
  "@/components/SearchField": moduleUrl("export default function SearchField() {return null;}"),
  "@/hooks/useDialogFocus": moduleUrl("export function useDialogFocus() {}"),
  "@/hooks/useSearchInput": moduleUrl("export function useSearchInput(seed) {const f = globalThis.__paletteFixture; f.seeds.push(seed); return f.search;}"),
  "@/hooks/useSearchNavigation": moduleUrl("export function useSearchNavigation() {return globalThis.__paletteFixture.navigation;}"),
  "@/hooks/useRecentSearches": moduleUrl("export function useRecentSearches() {return globalThis.__paletteFixture.history;}"),
  "./commandPaletteModel": new URL("../src/components/commandPaletteModel.ts", import.meta.url).href,
};
const source = await readFile(new URL("../src/components/CommandPalette.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
  assert.ok(stubs[name], `Unmocked palette import: ${name}`);
  return `from ${JSON.stringify(stubs[name])}`;
});
const { PaletteDialog } = await import(moduleUrl(compiled));

function unmount() {
  for (const effect of fixture.effects) effect?.cleanup?.();
  fixture.effects = [];
}
function setup({ input = "Queen", query = input.trim(), preparing = false, data = {}, errors = {}, fetching = {}, recent = [] } = {}) {
  unmount();
  Object.assign(fixture, {
    hooks: [], effects: [], cursor: 0, nextEffects: [], data, errors, fetching,
    requests: [], retries: [], played: [], routes: [], playlistCalls: [], remembered: [], fullSearches: [], closed: 0, seeds: [],
    pendingPlaylist: null,
  });
  fixture.search = {
    input, query, preparing,
    setInput(value) { this.input = value; this.preparing = value.trim() !== this.query; },
    clear() { this.input = ""; this.query = ""; this.preparing = false; },
    setComposing(value) { this.preparing = value; },
  };
  fixture.history = {
    recent, remember: (value) => fixture.remembered.push(value), remove: (value) => { fixture.history.recent = fixture.history.recent.filter((entry) => entry !== value); }, clear: () => { fixture.history.recent = []; },
  };
  fixture.navigation = { input, query, openResults: (value) => {fixture.fullSearches.push(value); fixture.history.remember(value);} };
  fixture.player = {
    radioSession: 0, setRadioActive() {this.radioSession += 1;},
    playQueue: (tracks, index, context) => fixture.played.push({tracks, index, context}),
  };
}
function nodes(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) { for (const child of node) nodes(child, predicate, found); return found; }
  if (predicate(node)) found.push(node);
  nodes(node.props?.children, predicate, found);
  return found;
}
function render() {
  fixture.cursor = 0;
  fixture.nextEffects = [];
  const tree = PaletteDialog({ onClose: () => {fixture.closed += 1;} });
  for (const effect of fixture.nextEffects) {
    const previous = fixture.effects[effect.index];
    if (previous && effect.deps.every((value, index) => Object.is(value, previous.deps[index]))) continue;
    previous?.cleanup?.();
    fixture.effects[effect.index] = {...effect, cleanup: effect.callback()};
  }
  return {
    tree,
    field: nodes(tree, (node) => typeof node.type === "function" && node.type.name === "SearchField")[0].props,
    rows: nodes(tree, (node) => node.props?.role === "option").map((node) => node.props),
    buttons: nodes(tree, (node) => node.type === "button").map((node) => node.props),
    alerts: nodes(tree, (node) => node.props?.role === "alert"),
  };
}
function key(field, value, overrides = {}) {
  const event = {key: value, nativeEvent: {isComposing: false}, preventDefault() {}, ...overrides};
  field.inputProps.onKeyDown(event);
}
const track = {id: "916424", title: "Without Me", artist: "Eminem", cover: "", album: "", duration_sec: 290};

test("palette requests every entity using the same canonical query", () => {
  setup({ data: {track: [track]} });
  render();
  assert.deepEqual(fixture.requests.map((request) => request.queryKey), [["search", "track", "Queen"], ["search", "artist", "Queen"], ["search", "album", "Queen"], ["search", "playlist", "Queen"]]);
  assert.ok(fixture.requests.every((request) => request.enabled));
  assert.deepEqual(fixture.remembered, []);
});
test("typing hides obsolete rows and rejects a click captured before the draft changed", async () => {
  setup({ data: {track: [track]} });
  const first = render();
  first.field.onValueChange("Daft Punk");
  await first.rows[0].onClick();
  assert.deepEqual(fixture.played, []);
  assert.deepEqual(fixture.remembered, []);
  assert.equal(render().rows.length, 0);
  assert.ok(fixture.requests.slice(-4).every((request) => !request.enabled));
});
test("Enter opens current full results while preparing; modifier Enter bypasses quick playback", () => {
  setup({ input: "Daft Punk", query: "Queen", preparing: true, data: {track: [track]} });
  key(render().field, "Enter");
  assert.deepEqual(fixture.fullSearches, ["Daft Punk"]);
  assert.deepEqual(fixture.played, []);
  setup({ data: {track: [track]} });
  key(render().field, "Enter", {ctrlKey: true});
  assert.deepEqual(fixture.fullSearches, ["Queen"]);
  assert.deepEqual(fixture.played, []);
});
test("Enter activates a ready track and only confirmed activation updates history", () => {
  setup({ data: {track: [track]} });
  key(render().field, "Enter");
  assert.deepEqual(fixture.played, [{tracks: [track], index: 0, context: "Suche: Queen"}]);
  assert.deepEqual(fixture.remembered, ["Queen"]);
  assert.equal(fixture.closed, 1);
});
test("selection survives a late track response inserted before a chosen artist", () => {
  setup({ data: {artist: [{id: "27", name: "Queen", picture: ""}]} });
  let screen = render();
  screen.rows[0].onMouseEnter();
  fixture.data.track = [track];
  screen = render();
  assert.equal(screen.rows[1]["aria-selected"], true);
  key(screen.field, "Enter");
  assert.deepEqual(fixture.routes, ["/artist/27"]);
  assert.deepEqual(fixture.played, []);
});
test("empty-query history uses full navigation and never records on blur", () => {
  setup({ input: "", recent: ["Queen"] });
  const screen = render();
  assert.equal(screen.field.inputProps.onBlur, undefined);
  screen.buttons.find((button) => Array.isArray(button.children) && button.children.some((child) => child?.props?.children === "Queen")).onClick();
  assert.deepEqual(fixture.fullSearches, ["Queen"]);
  assert.deepEqual(fixture.remembered, ["Queen"]);
});
test("clear is immediate and no one-character query starts providers", () => {
  setup({ data: {track: [track]} });
  render().field.onClear();
  assert.equal(render().rows.length, 0);
  setup({ input: "Q" });
  render();
  assert.ok(fixture.requests.every((request) => !request.enabled));
});
function playlistScreen() {
  setup({data: {playlist: [{id: "mix", title: "Mix", cover: "", track_count: 1}]}});
  let resolve;
  fixture.pendingPlaylist = new Promise((complete) => {resolve = complete;});
  return {screen: render(), resolve};
}
test("playlist activation takes a synchronous lock before a rerender", async () => {
  const {screen, resolve} = playlistScreen();
  screen.rows[0].onClick();
  screen.rows[0].onClick();
  assert.deepEqual(fixture.playlistCalls, ["mix"]);
  assert.deepEqual(fixture.remembered, []);
  resolve({tracks: [track]});
  await new Promise(setImmediate);
  assert.deepEqual(fixture.played, [{tracks: [track], index: 0, context: "Mix"}]);
  assert.deepEqual(fixture.remembered, ["Queen"]);
});
test("new playback, changed input and dialog close each discard a late playlist", async () => {
  for (const cancel of [() => {fixture.player.radioSession += 1;}, (screen) => screen.field.onValueChange("new query"), () => unmount()]) {
    const {screen, resolve} = playlistScreen();
    screen.rows[0].onClick();
    cancel(screen);
    resolve({tracks: [track]});
    await new Promise(setImmediate);
    assert.deepEqual(fixture.played, []);
    assert.deepEqual(fixture.remembered, []);
  }
});
test("editing a query away and back cannot revive its cancelled playlist", async () => {
  const {screen, resolve} = playlistScreen();
  screen.rows[0].onClick();
  screen.field.onValueChange("Daft Punk");
  screen.field.onValueChange("Queen");
  resolve({tracks: [track]});
  await new Promise(setImmediate);
  assert.deepEqual(fixture.played, []);
  assert.deepEqual(fixture.remembered, []);
});
test("closing cancels pending playlist synchronously before component cleanup", async () => {
  const {screen, resolve} = playlistScreen();
  screen.rows[0].onClick();
  screen.tree.props.onClick();
  resolve({tracks: [track]});
  await new Promise(setImmediate);
  assert.equal(fixture.closed, 1);
  assert.deepEqual(fixture.played, []);
});
test("empty playlists fail visibly and leave their next explicit retry unlocked", async () => {
  const {screen, resolve} = playlistScreen();
  screen.rows[0].onClick();
  resolve({tracks: []});
  await new Promise(setImmediate);
  const failed = render();
  assert.match(failed.alerts[0].props.children, /keine abspielbaren Titel/);
  assert.deepEqual(fixture.played, []);
  assert.equal(failed.rows[0].disabled, false);
});
test("source errors expose details and retry only the failed source", () => {
  setup({errors: {artist: "HTTP 503: upstream unavailable"}, data: {track: [track]}});
  const screen = render();
  assert.equal(screen.rows.length, 1);
  assert.match(screen.alerts[0].props.children[0].props.children.join(""), /HTTP 503/);
  screen.buttons.find((button) => button.children === "Erneut versuchen").onClick();
  assert.deepEqual(fixture.retries, ["artist"]);
});
test("IME Enter does not play or navigate and the palette seed remains fixed", () => {
  setup({data: {track: [track]}});
  const first = render();
  key(first.field, "Enter", {nativeEvent: {isComposing: true}});
  fixture.navigation.input = "changed global query";
  render();
  assert.deepEqual(fixture.seeds, ["Queen", "Queen"]);
  assert.deepEqual(fixture.played, []);
  assert.deepEqual(fixture.fullSearches, []);
});
