import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = {
  stateIndex: 0,
  refIndex: 0,
  states: [],
  refs: [],
  recent: [],
  genres: null,
  api: null,
  player: null,
  trackStart: null,
  trackStarts: [],
  listStarts: [],
  errors: [],
  calls: [],
};
globalThis.__radioRouteFixture = fixture;

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = import.meta.resolve("react");
const empty = moduleUrl("export default function Component() { return null; }");
const imports = {
  react: moduleUrl(`
    export function useState(initial) {
      const fixture = globalThis.__radioRouteFixture;
      const index = fixture.stateIndex++;
      if (!(index in fixture.states)) fixture.states[index] = initial;
      return [fixture.states[index], (value) => {
        fixture.states[index] = typeof value === 'function' ? value(fixture.states[index]) : value;
      }];
    }
    export function useRef(initial) {
      const fixture = globalThis.__radioRouteFixture;
      const index = fixture.refIndex++;
      if (!(index in fixture.refs)) fixture.refs[index] = {current: initial};
      return fixture.refs[index];
    }
  `),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": moduleUrl(`import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, ...props}) { return createElement('a', {...props, href}, children); }`),
  "@tanstack/react-query": moduleUrl("export const useQuery = () => globalThis.__radioRouteFixture.genres;"),
  "@/lib/api": moduleUrl(`export const api = {
    genres: () => globalThis.__radioRouteFixture.api.genres(),
    homeMood: (tag) => globalThis.__radioRouteFixture.api.homeMood(tag),
    genre: (id) => globalThis.__radioRouteFixture.api.genre(id),
  };`),
  "@/lib/radio": moduleUrl(`
    export function startTrackRadio(track) {
      const fixture = globalThis.__radioRouteFixture;
      fixture.trackStarts.push(track);
      return fixture.trackStart(track);
    }
    export function startTrackListRadio(tracks, title) {
      globalThis.__radioRouteFixture.listStarts.push({tracks, title});
    }
  `),
  "@/lib/trackArtists": moduleUrl("export const trackArtistLabel = (track) => track.artist;"),
  "@/hooks/useLocalJson": moduleUrl("export const useLocalJson = () => [globalThis.__radioRouteFixture.recent];"),
  "@/store/player": moduleUrl("export const usePlayerStore = {getState: () => globalThis.__radioRouteFixture.player};"),
  "@/store/toast": moduleUrl("export const toast = {error: (message) => globalThis.__radioRouteFixture.errors.push(message)};"),
  "@/components/Skeleton": moduleUrl("export function CardGridSkeleton() { return null; }"),
  "@/components/icons": moduleUrl("export const PlayIcon = () => null; export const RadioIcon = PlayIcon; export const SpinnerIcon = PlayIcon;"),
  "@/components/CoverPlaceholder": empty,
};

// Compile the real route and capture its actual JSX callbacks. Hook state and
// refs persist between manual renders, so rapid clicks share the real lock.
const source = await readFile(new URL("../src/app/radio/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
  assert.ok(imports[name], `Unmocked Radio route import: ${name}`);
  return `from ${JSON.stringify(imports[name])}`;
});
const { default: RadioPage } = await import(moduleUrl(compiled));
const track = (id) => ({ id, title: `Song ${id}`, artist: "Artist", cover: "" });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function render() {
  fixture.stateIndex = 0;
  fixture.refIndex = 0;
  return RadioPage();
}

function elements(node, type) {
  if (Array.isArray(node)) return node.flatMap((child) => elements(child, type));
  if (!node || typeof node !== "object") return [];
  return [
    ...(node.type === type ? [node] : []),
    ...elements(node.props?.children, type),
  ];
}

function text(node) {
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (typeof node === "string" || typeof node === "number") return String(node);
  return node && typeof node === "object" ? text(node.props?.children) : "";
}

function station(tree, name) {
  const button = elements(tree, "button").find((element) =>
    `${element.props["aria-label"] ?? ""} ${text(element)}`.includes(name),
  );
  assert.ok(button, `Station button missing: ${name}`);
  return button;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const screen = () => renderToStaticMarkup(render());

beforeEach(() => {
  fixture.stateIndex = 0;
  fixture.refIndex = 0;
  fixture.states = [];
  fixture.refs = [];
  fixture.recent = [track("recent")];
  fixture.genres = { data: [{ id: "rock", name: "Rock" }], error: null, isLoading: false, isFetching: false, refetch: async () => {} };
  fixture.trackStarts = [];
  fixture.listStarts = [];
  fixture.errors = [];
  fixture.calls = [];
  fixture.player = {
    radioSession: 0,
    setRadioActive() { this.radioSession += 1; },
    _setError(message) { fixture.errors.push(message); },
  };
  fixture.api = {
    homeMood: async (tag) => { fixture.calls.push(["mood", tag]); return [track(tag)]; },
    genre: async (id) => { fixture.calls.push(["genre", id]); return { tracks: [track(id)] }; },
  };
  fixture.trackStart = async () => {};
});

test("Radio reserves a single startup before React rerenders after competing clicks", async () => {
  const request = deferred();
  fixture.api.homeMood = (tag) => { fixture.calls.push(["mood", tag]); return request.promise; };
  const tree = render();
  station(tree, "Chill-Radio").props.onClick();
  station(tree, "Rock").props.onClick();
  station(tree, "Song recent").props.onClick();
  assert.deepEqual(fixture.calls, [["mood", "chill"]]);
  assert.deepEqual(fixture.trackStarts, []);
  assert.equal(fixture.player.radioSession, 1);
  assert.ok(elements(render(), "button").every((button) => button.props.disabled));

  request.resolve([track("chill-result")]);
  await settle();
  assert.deepEqual(fixture.listStarts, [{ tracks: [track("chill-result")], title: "Chill-Radio" }]);
  assert.ok(elements(render(), "button").every((button) => !button.props.disabled));
});

test("personal station startup participates in the same lock as mood and genre requests", async () => {
  const request = deferred();
  fixture.trackStart = () => request.promise;
  const tree = render();
  station(tree, "Song recent").props.onClick();
  station(tree, "Fokus-Radio").props.onClick();
  station(tree, "Rock").props.onClick();
  assert.deepEqual(fixture.trackStarts, [track("recent")]);
  assert.deepEqual(fixture.calls, []);
  request.resolve();
  await settle();
  assert.ok(elements(render(), "button").every((button) => !button.props.disabled));
});

for (const kind of ["mood", "genre"]) {
  test(`a stale ${kind} station response cannot replace newer explicit playback`, async () => {
    const request = deferred();
    const name = kind === "mood" ? "Chill-Radio" : "Rock";
    if (kind === "mood") fixture.api.homeMood = () => request.promise;
    else fixture.api.genre = () => request.promise;
    station(render(), name).props.onClick();
    // Explicit playback increments this real ownership token in the player.
    fixture.player.radioSession += 1;
    request.resolve(kind === "mood" ? [track("old")] : { tracks: [track("old")] });
    await settle();
    assert.deepEqual(fixture.listStarts, []);
    assert.deepEqual(fixture.errors, []);
    assert.ok(elements(render(), "button").every((button) => !button.props.disabled));
  });

  test(`an empty ${kind} station reports its cause visibly and never starts playback`, async () => {
    const name = kind === "mood" ? "Chill-Radio" : "Rock";
    if (kind === "mood") fixture.api.homeMood = async () => [];
    else fixture.api.genre = async () => ({ tracks: [] });
    station(render(), name).props.onClick();
    await settle();
    assert.deepEqual(fixture.listStarts, []);
    assert.match(fixture.errors[0], /Für dieses Radio wurden keine Titel gefunden/);
    const html = screen();
    assert.match(html, /role="alert"/);
    assert.match(html, /Für dieses Radio wurden keine Titel gefunden/);
  });
}

test("a failed station releases the lock and clears its old error on the next startup", async () => {
  fixture.api.homeMood = async () => { throw new Error("Musikdienst: HTTP 503"); };
  station(render(), "Chill-Radio").props.onClick();
  await settle();
  assert.match(screen(), /Musikdienst: HTTP 503/);
  const tree = render();
  station(tree, "Rock").props.onClick();
  assert.doesNotMatch(screen(), /Musikdienst: HTTP 503/);
  await settle();
  assert.deepEqual(fixture.calls, [["genre", "rock"]]);
  assert.deepEqual(fixture.listStarts, [{ tracks: [track("rock")], title: "Rock-Radio" }]);
});

for (const kind of ["mood", "genre"]) {
  test(`a malformed ${kind} response names the invalid station data without replacing playback`, async () => {
    const name = kind === "mood" ? "Chill-Radio" : "Rock";
    if (kind === "mood") fixture.api.homeMood = async () => null;
    else fixture.api.genre = async () => null;
    station(render(), name).props.onClick();
    await settle();
    assert.deepEqual(fixture.listStarts, []);
    assert.match(fixture.errors[0], /Antwort.*keine gültige Titelliste/);
    assert.doesNotMatch(fixture.errors[0], /Cannot read|TypeError/);
    assert.match(screen(), /keine gültige Titelliste/);
  });
}

test("malformed saved recent tracks name the localStorage key before rendering", () => {
  fixture.recent = { unexpected: [] };
  assert.throws(render, /localStorage "sf_recent_tracks".*keine gültige Titelliste/);
});
