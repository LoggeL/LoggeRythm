import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  libraryTabFromParam,
  libraryTabHref,
} from "../src/app/library/navigation.ts";

const fixture = {
  search: "",
  me: null,
  likes: null,
  playlists: null,
  following: null,
  recent: [],
  enabled: {},
  downloads: {},
};
globalThis.__libraryRouteFixture = fixture;

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const reactUrl = import.meta.resolve("react");
const stubs = {
  react: reactUrl,
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, scroll, ...props}) { return createElement("a", {...props, href}, children); }`,
  ),
  "next/navigation": moduleUrl(
    `export const useSearchParams = () => new URLSearchParams(globalThis.__libraryRouteFixture.search);`,
  ),
  "@/hooks/useAuth": moduleUrl(
    `export const useMe = () => globalThis.__libraryRouteFixture.me;`,
  ),
  "@/hooks/useLibrary": moduleUrl(
    `export const useLikes = (enabled) => {globalThis.__libraryRouteFixture.enabled.likes = enabled; return globalThis.__libraryRouteFixture.likes;}; export const usePlaylists = (enabled) => {globalThis.__libraryRouteFixture.enabled.playlists = enabled; return globalThis.__libraryRouteFixture.playlists;};`,
  ),
  "@/hooks/useFollows": moduleUrl(
    `export const useFollowing = (enabled) => {globalThis.__libraryRouteFixture.enabled.following = enabled; return globalThis.__libraryRouteFixture.following;};`,
  ),
  "@/hooks/useLocalJson": moduleUrl(
    `export const useLocalJson = () => [globalThis.__libraryRouteFixture.recent, () => {}];`,
  ),
  "@/hooks/useDownloads": moduleUrl(
    `export const useDownloads = () => ({downloads: globalThis.__libraryRouteFixture.downloads, supported: true});`,
  ),
  "@/lib/api": moduleUrl(`export const api = {};`),
  "@/lib/slugs": moduleUrl(
    `export const playlistPath = (playlist) => "/playlist/" + playlist.id;`,
  ),
  "@/store/player": moduleUrl(
    `export const usePlayerStore = (selector) => selector({playQueue() {}}); export const getRecentTracks = () => [];`,
  ),
  "@/store/toast": moduleUrl(`export const toast = {};`),
  "@/components/TrackRow": moduleUrl(
    `export default function TrackRow() { return null; }`,
  ),
  "@/components/ArtistCard": moduleUrl(
    `export default function ArtistCard() { return null; }`,
  ),
  "@/components/CoverPlaceholder": moduleUrl(
    `export default function CoverPlaceholder() { return null; }`,
  ),
  "@/components/Modal": moduleUrl(
    `export default function Modal() { return null; }`,
  ),
  "@/components/Skeleton": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export function RowListSkeleton() { return createElement("span", {"data-testid": "loading"}); } export const CardGridSkeleton = RowListSkeleton;`,
  ),
  "@/components/icons": moduleUrl(
    `export function HeartIcon() { return null; } export function DownloadIcon() { return null; } export function PlayIcon() { return null; } export function PlusIcon() { return null; }`,
  ),
  "./CreatePlaylistDialog": moduleUrl(
    `export default function CreatePlaylistDialog() { return null; }`,
  ),
  "./navigation": new URL("../src/app/library/navigation.ts", import.meta.url)
    .href,
};

// Compile the real route with its data hooks and Next navigation stubbed. React
// still renders the actual screen, so errors and empty states are exercised.
const source = await readFile(
  new URL("../src/app/library/page.tsx", import.meta.url),
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
const { default: LibraryPage } = await import(moduleUrl(compiled));

const success = (data) => ({
  data,
  error: null,
  isSuccess: true,
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: async () => {},
});
const failure = (message) => ({
  data: undefined,
  error: new Error(message),
  isSuccess: false,
  isLoading: false,
  isError: true,
  isFetching: false,
  refetch: async () => {},
});

function screen(search = "") {
  fixture.search = search;
  return renderToStaticMarkup(createElement(LibraryPage));
}

function reset() {
  fixture.me = success({ id: "user" });
  fixture.likes = success([]);
  fixture.playlists = success([]);
  fixture.following = success([]);
  fixture.recent = [];
  fixture.enabled = {};
  fixture.downloads = {};
}

function assertActiveTab(html, href) {
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)].map(([anchor]) => anchor);
  const selected = anchors.find(
    (anchor) =>
      anchor.includes(`href="${href}"`) &&
      anchor.includes('aria-current="page"'),
  );
  assert.ok(selected, `Missing navigation link: ${href}`);
  assert.ok(selected.includes('aria-current="page"'));
  assert.equal(
    anchors.filter((anchor) => anchor.includes('aria-current="page"')).length,
    1,
  );
}

test("library tabs follow current URL and preserve unrelated query parameters", () => {
  assert.equal(libraryTabFromParam("liked"), "liked");
  assert.equal(libraryTabFromParam("following"), "following");
  assert.equal(libraryTabFromParam(null), "playlists");
  assert.equal(libraryTabFromParam("unsupported"), "playlists");
  const next = new URL(
    libraryTabHref("tab=liked&source=sidebar&tab=recent", "following"),
    "https://example.test",
  );
  assert.deepEqual(next.searchParams.getAll("tab"), ["following"]);
  assert.equal(next.searchParams.get("source"), "sidebar");
  reset();
  assertActiveTab(
    screen("tab=liked&source=sidebar"),
    "/library?tab=liked&amp;source=sidebar",
  );
  assertActiveTab(screen("tab=following"), "/library?tab=following");
});

test("account network failures show their cause instead of an anonymous sign-in screen", () => {
  reset();
  fixture.me = failure("Verbindung unterbrochen");
  const html = screen();
  assert.match(html, /role="alert"/);
  assert.match(html, /Verbindung unterbrochen/);
  assert.match(html, /Erneut versuchen/);
  assert.doesNotMatch(html, /href="\/login"/);
});

test("failed likes and follows never appear as successful empty collections", () => {
  reset();
  fixture.likes = failure("Likes: HTTP 503");
  let html = screen("tab=liked");
  assert.match(html, /Likes: HTTP 503/);
  assert.doesNotMatch(html, /Du hast noch keine Titel geliked/);
  fixture.following = failure("Künstler: HTTP 502");
  html = screen("tab=following");
  assert.match(html, /Künstler: HTTP 502/);
  assert.doesNotMatch(html, /Du folgst noch keinen Künstlern/);
});

test("an account refresh failure stays visible without hiding cached library content", () => {
  reset();
  fixture.me = {
    ...failure("Profilaktualisierung: HTTP 503"),
    data: { id: "user" },
  };
  const html = screen("tab=liked");
  assert.match(html, /Profilaktualisierung: HTTP 503/);
  assert.match(html, /Du hast noch keine Titel geliked/);
  assert.doesNotMatch(html, /href="\/login"/);
});

test("collections only show empty copy after a successful request", () => {
  reset();
  fixture.following = {
    ...success(undefined),
    isSuccess: false,
    isLoading: true,
  };
  assert.match(screen("tab=following"), /data-testid="loading"/);
  assert.doesNotMatch(
    screen("tab=following"),
    /Du folgst noch keinen Künstlern/,
  );
  fixture.following = success([]);
  assert.match(screen("tab=following"), /Du folgst noch keinen Künstlern/);
  fixture.playlists = failure("Playlists: HTTP 500");
  fixture.likes = failure("Likes: HTTP 503");
  const html = screen();
  assert.match(html, /Playlists: HTTP 500/);
  assert.doesNotMatch(html, /Likes: HTTP 503/);
  assert.doesNotMatch(html, /0 gelikte Titel/);
});

test("library requests only the collection selected by the current tab", () => {
  reset();
  screen();
  assert.deepEqual(fixture.enabled, {
    likes: false,
    playlists: true,
    following: false,
  });
  screen("tab=liked");
  assert.deepEqual(fixture.enabled, {
    likes: true,
    playlists: false,
    following: false,
  });
  screen("tab=following");
  assert.deepEqual(fixture.enabled, {
    likes: false,
    playlists: false,
    following: true,
  });
  for (const tab of ["recent", "downloads"]) {
    screen(`tab=${tab}`);
    assert.deepEqual(fixture.enabled, {
      likes: false,
      playlists: false,
      following: false,
    });
  }
});

test("the library exposes playlist creation on every screen including mobile", () => {
  reset();
  for (const tab of [
    "playlists",
    "liked",
    "following",
    "recent",
    "downloads",
  ]) {
    assert.match(
      screen(`tab=${tab}`),
      /<button[^>]*>Playlist erstellen<\/button>/,
    );
  }
});

test("saved downloads keep their names and provide an explicit whole-device cleanup action", () => {
  reset();
  fixture.downloads = {
    legacy: { name: "Meine alte Offline-Playlist", total: 5 },
  };
  const html = screen("tab=downloads");
  assert.match(html, /Meine alte Offline-Playlist/);
  assert.match(html, /5 Titel offline/);
  assert.match(html, /Alle Offline-Downloads löschen/);
  assert.match(html, /href="\/playlist\/legacy"/);
});
