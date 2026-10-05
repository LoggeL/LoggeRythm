import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { beforeEach } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = { results: {} };
globalThis.__discoverRouteFixture = fixture;
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = import.meta.resolve("react");
const empty = moduleUrl("export default function Component() { return null; }");
const imports = {
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": moduleUrl(`import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, ...props}) { return createElement('a', {...props, href}, children); }`),
  "@tanstack/react-query": moduleUrl(`export function useQuery(options) {
    const response = globalThis.__discoverRouteFixture.results[options.queryKey[0]];
    if (!response) throw new Error('Unconfigured query: ' + options.queryKey[0]);
    return response;
  }`),
  "@/lib/api": moduleUrl("export const api = {};"),
  "@/lib/slugs": moduleUrl("export const playlistPath = (playlist) => '/playlist/' + playlist.id;"),
  "@/components/AlbumCard": moduleUrl(`import {createElement} from ${JSON.stringify(reactUrl)}; export default function AlbumCard({album}) { return createElement('p', null, album.title); }`),
  "@/components/ShelfCard": moduleUrl(`import {createElement} from ${JSON.stringify(reactUrl)}; export default function ShelfCard({shelf}) { return createElement('p', null, shelf.title); }`),
  "@/components/CoverPlaceholder": empty,
  "@/components/Skeleton": moduleUrl(`import {createElement} from ${JSON.stringify(reactUrl)}; export const CardGridSkeleton = () => createElement('span', {'data-testid': 'loading'});`),
  "@/components/icons": moduleUrl("export const CompassIcon = () => null;"),
};
const source = await readFile(new URL("../src/app/genre/page.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
}).outputText.replace(/from (["'])([^"']+)\1/g, (_match, _quote, name) => {
  assert.ok(imports[name], `Unmocked Discover route import: ${name}`);
  return `from ${JSON.stringify(imports[name])}`;
});
const { default: DiscoverPage } = await import(moduleUrl(compiled));
const success = (data) => ({ data, error: null, isLoading: false, isFetching: false, refetch: async () => {} });
const failure = (message) => ({ ...success(undefined), error: new Error(message) });
const screen = () => renderToStaticMarkup(createElement(DiscoverPage));

beforeEach(() => {
  fixture.results = {
    "home-collections": success([]),
    "genres": success([]),
    "new-releases": success([]),
    "public-playlists": success([]),
  };
});

for (const [query, emptyCopy] of [
  ["home-collections", "Zurzeit sind keine Charts verfügbar"],
  ["genres", "Zurzeit sind keine Genres verfügbar"],
  ["new-releases", "Zurzeit sind keine neuen Veröffentlichungen verfügbar"],
  ["public-playlists", "Es wurden noch keine öffentlichen Playlists geteilt"],
]) {
  test(`Discover keeps failed ${query} distinct from a successful empty section`, () => {
    fixture.results[query] = failure(`${query}: HTTP 503`);
    const html = screen();
    assert.match(html, /role="alert"/);
    assert.ok(html.includes(`${query}: HTTP 503`));
    assert.match(html, /Erneut versuchen/);
    assert.ok(!html.includes(emptyCopy));
  });
}

test("one failed Discover section keeps other real collections visible", () => {
  fixture.results.genres = failure("Genres: HTTP 502");
  fixture.results["home-collections"] = success([{ key: "chart", title: "Aktuelle Charts" }]);
  fixture.results["new-releases"] = success([{ id: "album", title: "Neues Album" }]);
  fixture.results["public-playlists"] = success([{ id: "playlist", name: "Community-Mix", track_count: 3 }]);
  const html = screen();
  assert.match(html, /Genres: HTTP 502/);
  for (const title of ["Aktuelle Charts", "Neues Album", "Community-Mix"]) assert.ok(html.includes(title));
});

test("a Discover refresh error reports its cause and retains cached releases", () => {
  fixture.results["new-releases"] = {
    ...failure("Veröffentlichungen: HTTP 503"),
    data: [{ id: "cached", title: "Bereits geladenes Album" }],
  };
  const html = screen();
  assert.match(html, /Veröffentlichungen: HTTP 503/);
  assert.match(html, /Der zuletzt geladene Stand bleibt sichtbar/);
  assert.match(html, /Bereits geladenes Album/);
});

test("community playlists have a loading state before an empty response arrives", () => {
  fixture.results["public-playlists"] = { ...success(undefined), isLoading: true, isFetching: true };
  const html = screen();
  const community = html.match(/<section id="community"[\s\S]*?<\/section>/)?.[0];
  assert.ok(community);
  assert.match(community, /aria-busy="true"/);
  assert.match(community, /data-testid="loading"/);
  assert.doesNotMatch(community, /Es wurden noch keine öffentlichen Playlists geteilt/);
});
