import assert from "node:assert/strict";
import test from "node:test";
import { compileInto, compileSource } from "./support/compile.mjs";
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
  invitations: null,
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
    `export const useSearchParams = () => new URLSearchParams(globalThis.__libraryRouteFixture.search); export const useRouter = () => ({ push() {} });`,
  ),
  "@/hooks/useAuth": moduleUrl(
    `export const useMe = () => globalThis.__libraryRouteFixture.me;`,
  ),
  "@/hooks/useLibrary": moduleUrl(
    `export const useLikes = (enabled) => {globalThis.__libraryRouteFixture.enabled.likes = enabled; return globalThis.__libraryRouteFixture.likes;}; export const usePlaylists = (enabled) => {globalThis.__libraryRouteFixture.enabled.playlists = enabled; return globalThis.__libraryRouteFixture.playlists;}; export const useMyPlaylistInvitations = () => {globalThis.__libraryRouteFixture.enabled.invitations = true; return globalThis.__libraryRouteFixture.invitations;}; const idle = () => ({ isPending: false, isError: false, error: null, mutate() {} }); export const useAcceptPlaylistInvitation = idle; export const useDeclinePlaylistInvitation = idle;`,
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
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function TrackRow({track}) { return createElement("p", {"data-track": track.id}, track.title); }`,
  ),
  "@/components/ArtistCard": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function ArtistCard({artist}) { return createElement("p", null, artist.name); }`,
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
  // View transitions need a browser; tiles render their content unwrapped.
  "@/components/motion/Morph": moduleUrl(
    `export const Morph = ({children}) => children; export const useMorphSource = () => ({arm() {}});`,
  ),
  "@/components/icons": moduleUrl(
    `export function HeartIcon() { return null; } export const DownloadIcon = HeartIcon; export const DownloadedIcon = HeartIcon; export const PlayIcon = HeartIcon; export const PlusIcon = HeartIcon; export const LibraryIcon = HeartIcon; export const ShuffleIcon = HeartIcon; export const SearchIcon = HeartIcon; export const ClockIcon = HeartIcon; export const UserIcon = HeartIcon; export const UsersIcon = HeartIcon; export const SpinnerIcon = HeartIcon; export const RadioIcon = HeartIcon;`,
  ),
  "@/lib/radio": moduleUrl(`export const startSeededRadio = async () => {};`),
  "@/app/playlist/_components/usePlaylistOffline": moduleUrl(
    `export const usePlaylistOffline = () => ({ supported: false, downloaded: false, pending: null, progress: null, sizePreviewBytes: null, toggle() {} });`,
  ),
  "./CreatePlaylistDialog": moduleUrl(
    `export default function CreatePlaylistDialog() { return null; }`,
  ),
  "./navigation": new URL("../src/app/library/navigation.ts", import.meta.url)
    .href,
};

// Compile the real route, its tabs and the shared primitives with the data
// hooks and Next navigation stubbed. React still renders the actual screen,
// so errors and empty states are exercised.
await compileInto(stubs, [
  ["@/lib/playlistPermissions", "src/lib/playlistPermissions.ts"],
  ["@/components/Avatar", "src/components/Avatar.tsx"],
  ["@/hooks/useRecentTracks", "src/hooks/useRecentTracks.ts"],
  ["@/components/ui/Cover", "src/components/ui/Cover.tsx"],
  ["@/components/ui/QueryError", "src/components/ui/QueryError.tsx"],
  ["@/components/ui/EmptyState", "src/components/ui/EmptyState.tsx"],
  ["@/components/browse/QueryState", "src/components/browse/QueryState.tsx"],
  ["./filter", "src/app/library/_tabs/filter.ts"],
  ["./TabHeader", "src/app/library/_tabs/TabHeader.tsx"],
  ["./ListFilter", "src/app/library/_tabs/ListFilter.tsx"],
  ["./TrackCollection", "src/app/library/_tabs/TrackCollection.tsx"],
  ["./_tabs/PlaylistsTab", "src/app/library/_tabs/PlaylistsTab.tsx"],
  ["./_tabs/PlaylistInvitations", "src/app/library/_tabs/PlaylistInvitations.tsx"],
  ["./_tabs/LikedTab", "src/app/library/_tabs/LikedTab.tsx"],
  ["./_tabs/FollowingTab", "src/app/library/_tabs/FollowingTab.tsx"],
  ["./_tabs/RecentTab", "src/app/library/_tabs/RecentTab.tsx"],
  ["./_tabs/DownloadsTab", "src/app/library/_tabs/DownloadsTab.tsx"],
]);
const { default: LibraryPage } = await import(
  await compileSource("src/app/library/page.tsx", stubs),
);

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
  fixture.invitations = success([]);
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
    invitations: true,
  });
  fixture.enabled = {};
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

const songs = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `song-${index}`,
    title: `Lied ${index}`,
    artist: "Band",
    album: "Album",
  }));

test("playlists form a grid with the liked-songs tile, covers and a create tile", () => {
  reset();
  fixture.playlists = success([
    { id: "road", name: "Roadtrip", track_count: 12, cover_url: "road.jpg" },
  ]);
  const html = screen();
  assert.match(html, /1 Playlist</);
  assert.match(html, /<a[^>]*href="\/playlist\/road"[^>]*>[\s\S]*?<img src="road.jpg"/);
  assert.match(html, /<a[^>]*href="\/library\?tab=liked"[^>]*>.*?Gelikte Titel/);
  assert.match(html, /Neue Playlist/);
  assert.doesNotMatch(html, /Playlists filtern/);
  fixture.playlists = success([]);
  const empty = screen();
  assert.match(empty, /Hier ist Platz für deine erste Playlist/);
  assert.doesNotMatch(empty, /Neue Playlist/);
});

test("collaborative and shared playlists show badges, owner context and scope filter chips", () => {
  reset();
  fixture.playlists = success([
    { id: "1", name: "Eigene Liste", track_count: 4, is_owner: true, is_collaborative: true },
    { id: "2", name: "Geteilte Liste", track_count: 7, is_owner: false, is_collaborator: true, is_collaborative: true, owner_name: "Jule" },
  ]);
  const html = screen();
  assert.match(html, /aria-label="Playlist-Filter"/);
  assert.match(html, /Eigene/);
  assert.match(html, /Geteilt/);
  assert.match(html, /Gemeinsam · 4 Titel/);
  assert.match(html, /Gemeinsam · von Jule · 7 Titel/);
});

test("liked songs offer play-all and shuffle, and long lists add a filter and sort order", () => {
  reset();
  fixture.likes = success(songs(3));
  let html = screen("tab=liked");
  assert.match(html, /<button[^>]*class="play-fab[^"]*"[^>]*aria-label="Gelikte Titel abspielen"/);
  assert.match(html, /aria-label="Gelikte Titel zufällig abspielen"/);
  assert.equal(html.match(/data-track=/g).length, 3);
  assert.doesNotMatch(html, /In gelikten Titeln suchen/);
  fixture.likes = success(songs(11));
  html = screen("tab=liked");
  assert.match(html, /aria-label="In gelikten Titeln suchen"/);
  assert.match(html, /aria-label="Titel sortieren"/);
  fixture.likes = success([]);
  assert.doesNotMatch(screen("tab=liked"), /class="play-fab/);
});

test("the history tab lists the titles kept on this device and explains an empty history", () => {
  reset();
  assert.match(screen("tab=recent"), /Hier erscheinen die Titel, die du auf diesem Gerät hörst/);
  fixture.recent = songs(2);
  const html = screen("tab=recent");
  assert.match(html, /2 Titel auf diesem Gerät/);
  assert.match(html, /aria-label="Zuletzt gehört abspielen"/);
  assert.equal(html.match(/data-track=/g).length, 2);
});

test("pending playlist invitations appear above the playlists and nowhere else", () => {
  reset();
  assert.doesNotMatch(screen(), /playlist-invitations-heading/);
  fixture.invitations = success([
    {
      id: 9,
      playlist: { playlist_id: 51, name: "Kellerparty 2026", cover_url: null, track_count: 14, collaborator_count: 1, owner: { id: 3, display_name: "Tariq" } },
      invited_by: { id: 3, display_name: "Tariq", avatar_url: null },
      created_at: "2026-11-21T16:00:00Z",
    },
  ]);
  const html = screen();
  const invitationsAt = html.indexOf('id="playlist-invitations-heading"');
  assert.ok(invitationsAt > 0, "Einladungen section missing");
  assert.ok(invitationsAt < html.indexOf('id="playlist-heading"'), "Einladungen must come before Deine Playlists");
  assert.match(html, /Kellerparty 2026/);
  assert.match(html, />Annehmen</);
  assert.match(html, />Ablehnen</);
  assert.doesNotMatch(screen("tab=liked"), /playlist-invitations-heading/);
});
