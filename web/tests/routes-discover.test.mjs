import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const fixture = { results: {} };
globalThis.__discoverRouteFixture = fixture;
const reactUrl = import.meta.resolve("react");
const empty = moduleUrl("export default function Component() { return null; }");
const imports = {
  react: reactUrl,
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
  // Shelves need a browser to measure; the stub keeps their content and loading marker.
  "@/components/browse/Shelf": moduleUrl(`import {createElement} from ${JSON.stringify(reactUrl)}; export default function Shelf({label, children}) { return createElement('div', {'data-shelf': label}, children); } export const ShelfSkeleton = () => createElement('span', {'data-testid': 'loading'});`),
  "@/components/icons": moduleUrl("export const CompassIcon = () => null;"),
};
await compileInto(imports, [
  ["@/components/ui/Cover", "src/components/ui/Cover.tsx"],
  ["@/components/ui/QueryError", "src/components/ui/QueryError.tsx"],
  ["@/components/ui/EmptyState", "src/components/ui/EmptyState.tsx"],
  ["@/components/ui/SectionHeader", "src/components/ui/SectionHeader.tsx"],
  ["@/components/browse/BrowseTile", "src/components/browse/BrowseTile.tsx"],
  ["@/components/browse/QueryState", "src/components/browse/QueryState.tsx"],
], "Discover route");
const { default: DiscoverPage } = await import(await compileSource("src/app/genre/page.tsx", imports, "Discover route"));
const success = (data) => ({ data, error: null, isError: false, isLoading: false, isFetching: false, refetch: async () => {} });
const failure = (message) => ({ ...success(undefined), error: new Error(message), isError: true });
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

test("genres render as tiles linking to their pages and charts, releases and playlists as shelves", () => {
  fixture.results.genres = success([{ id: 152, name: "Rock", picture: "rock.jpg" }]);
  fixture.results["home-collections"] = success([{ key: "chart", title: "Aktuelle Charts" }]);
  fixture.results["public-playlists"] = success([{ id: "playlist", name: "Community-Mix", track_count: 3, owner_name: "Sam" }]);
  const html = screen();
  assert.match(html, /<a[^>]*href="\/genre\/152"[^>]*>.*?Rock/);
  assert.match(html, /data-shelf="Charts"/);
  assert.match(html, /data-shelf="Playlists der Community"/);
  assert.match(html, /href="\/playlist\/playlist"/);
  assert.match(html, /von Sam · 3 Titel/);
});
