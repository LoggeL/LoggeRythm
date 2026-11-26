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
  "@/hooks/useLibrary": moduleUrl("export const usePlaylists = () => globalThis.__discoverRouteFixture.results.playlists;"),
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
  ["./discoverPlaylists", "src/app/genre/discoverPlaylists.ts"],
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
    "playlists": success([]),
  };
});

for (const [query, emptyCopy] of [
  ["home-collections", "Zurzeit sind keine Charts verfügbar"],
  ["genres", "Zurzeit sind keine Genres verfügbar"],
  ["new-releases", "Zurzeit sind keine neuen Veröffentlichungen verfügbar"],
  ["public-playlists", "Hier gibt es noch keine Playlists"],
  ["playlists", "Hier gibt es noch keine Playlists"],
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

for (const query of ["public-playlists", "playlists"]) {
  test(`the playlists row keeps loading until ${query} has answered`, () => {
    fixture.results[query] = { ...success(undefined), isLoading: true, isFetching: true };
    fixture.results[query === "playlists" ? "public-playlists" : "playlists"] = success([{ id: 4, name: "Schon geladen", track_count: 2 }]);
    const html = screen();
    const section = html.match(/<section id="playlists"[\s\S]*?<\/section>/)?.[0];
    assert.ok(section);
    assert.match(section, /aria-busy="true"/);
    assert.match(section, /data-testid="loading"/);
    assert.doesNotMatch(section, /Hier gibt es noch keine Playlists/);
    assert.doesNotMatch(section, /Schon geladen/);
  });

  test(`a failed ${query} request is never shown as a complete playlists row`, () => {
    fixture.results[query] = failure(`${query}: HTTP 503`);
    fixture.results[query === "playlists" ? "public-playlists" : "playlists"] = success([{ id: 4, name: "Schon geladen", track_count: 2 }]);
    const html = screen();
    const section = html.match(/<section id="playlists"[\s\S]*?<\/section>/)?.[0];
    assert.ok(section);
    assert.match(section, /role="alert"/);
    assert.ok(section.includes(`Playlists konnten nicht geladen werden: ${query}: HTTP 503`));
    assert.doesNotMatch(section, /Schon geladen/);
    assert.doesNotMatch(section, /data-shelf/);
  });
}

test("a failed playlists refresh reports its cause and keeps the last loaded row", () => {
  fixture.results.playlists = { ...failure("playlists: HTTP 500"), data: [{ id: 4, name: "Roadtrip", track_count: 2 }] };
  fixture.results["public-playlists"] = success([{ id: 9, name: "Community-Mix", track_count: 3, owner_name: "Sam" }]);
  const html = screen();
  assert.match(html, /playlists: HTTP 500/);
  assert.match(html, /Der zuletzt geladene Stand bleibt sichtbar/);
  for (const name of ["Roadtrip", "Community-Mix"]) assert.ok(html.includes(name));
});

test("genres render as tiles linking to their pages and charts, releases and playlists as shelves", () => {
  fixture.results.genres = success([{ id: 152, name: "Rock", picture: "rock.jpg" }]);
  fixture.results["home-collections"] = success([{ key: "chart", title: "Aktuelle Charts" }]);
  fixture.results["public-playlists"] = success([{ id: "playlist", name: "Community-Mix", track_count: 3, owner_name: "Sam" }]);
  const html = screen();
  assert.match(html, /<a[^>]*href="\/genre\/152"[^>]*>.*?Rock/);
  assert.match(html, /data-shelf="Charts"/);
  assert.match(html, /data-shelf="Playlists"/);
  assert.match(html, /href="\/playlist\/playlist"/);
  assert.match(html, /von Sam · 3 Titel/);
});

test("the playlists row lists the user's own playlists first, marked as theirs, then the community's", () => {
  fixture.results.playlists = success([
    { id: 4, name: "Roadtrip", track_count: 12, is_public: false, owner_name: null },
    { id: 2, name: "Sonntag", track_count: 1, is_public: true, owner_name: null },
  ]);
  fixture.results["public-playlists"] = success([
    { id: 2, name: "Sonntag", track_count: 1, is_public: true, owner_name: "Alex" },
    { id: 9, name: "Community-Mix", track_count: 3, is_public: true, owner_name: "Sam" },
  ]);
  const html = screen();
  const section = html.match(/<section id="playlists"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.doesNotMatch(section, /Deine eigenen und die der Community/, "no description under the heading");
  assert.deepEqual(
    [...section.matchAll(/href="\/playlist\/([^"]+)"/g)].map((match) => match[1]),
    ["4", "2", "9"],
  );
  assert.match(section, /Roadtrip<\/div><div[^>]*>Von dir · 12 Titel/);
  assert.match(section, /Sonntag<\/div><div[^>]*>Von dir · 1 Titel/);
  assert.match(section, /Community-Mix<\/div><div[^>]*>von Sam · 3 Titel/);
  assert.doesNotMatch(section, /von Alex/);
});

test("the page links to the playlists section under its new name", () => {
  const html = screen();
  assert.match(html, /<a href="#playlists"[^>]*>Playlists<\/a>/);
  assert.doesNotMatch(html, /Playlists der Community|href="#community"/);
});

test("Discover distinguishes owned collaborative and shared-with-me playlists", () => {
  fixture.results.playlists = success([
    { id: 1, name: "Eigenes Team", track_count: 5, is_public: true, is_owner: true, is_collaborative: true, owner_name: "Demo" },
    { id: 4, name: "WG-Küche", track_count: 8, is_public: false, is_owner: false, is_collaborator: true, is_collaborative: true, owner_name: "Jule" },
  ]);
  const html = screen();
  const section = html.match(/<section id="playlists"[\s\S]*?<\/section>/)?.[0];
  assert.ok(section);
  assert.match(section, /Eigenes Team<\/div><div[^>]*>Gemeinsam · Von dir · 5 Titel/);
  assert.match(section, /WG-Küche<\/div><div[^>]*>Gemeinsam · von Jule · 8 Titel/);
  assert.doesNotMatch(section, /WG-Küche<\/div><div[^>]*>Von dir/);
});
