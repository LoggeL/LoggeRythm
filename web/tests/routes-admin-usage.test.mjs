import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";

const reactUrl = import.meta.resolve("react");

const fixture = {
  pathname: "/account",
  searchParams: new URLSearchParams(),
  me: {
    id: 1,
    email: "admin@test",
    display_name: "Admin",
    is_admin: true,
    is_approved: true,
    avatar_url: null,
  },
  meQuery: null,
  requests: [],
  queries: {},
  redirects: [],
};
globalThis.__adminUsageRouteFixture = fixture;

const iconStub = moduleUrl(`
  import { createElement } from ${JSON.stringify(reactUrl)};
  function Icon() { return createElement('svg'); }
  export const ChevronLeftIcon = Icon;
  export const ChevronRightIcon = Icon;
  export const LockIcon = Icon;
  export const RefreshIcon = Icon;
  export const SearchIcon = Icon;
  export const UsersIcon = Icon;
  export const CloseIcon = Icon;
  export const DevicesIcon = Icon;
  export const LaptopIcon = Icon;
  export const PhoneIcon = Icon;
  export const TabletIcon = Icon;
  export const TvIcon = Icon;
  export const SpeakerIcon = Icon;
  export const StatusIcon = Icon;
  export const UserIcon = Icon;
  export const VisualizerIcon = Icon;
  export const HeartIcon = Icon;
  export const DownloadedIcon = Icon;
  export const PlusIcon = Icon;
  export const LibraryIcon = Icon;
  export const ClockIcon = Icon;
  export const HomeIcon = Icon;
  export const CompassIcon = Icon;
  export const RadioIcon = Icon;
  export const LogOutIcon = Icon;
  export const TrashIcon = Icon;
  export const PlayIcon = Icon;
  export const ShuffleIcon = Icon;
  export const QueueIcon = Icon;
`);

const stubs = {
  react: reactUrl,
  "react-dom": moduleUrl("export function createPortal(children) { return children; }"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function Link({ href, children, ...props }) { return createElement('a', { ...props, href }, children); }`,
  ),
  "next/navigation": moduleUrl(`
    export function useRouter() { return { replace() {}, push() {}, back() {}, forward() {} }; }
    export function useSearchParams() { return globalThis.__adminUsageRouteFixture.searchParams; }
    export function usePathname() { return globalThis.__adminUsageRouteFixture.pathname; }
    export function redirect(target) {
      globalThis.__adminUsageRouteFixture.redirects.push(target);
      const err = new Error('NEXT_REDIRECT:' + target);
      err.target = target;
      throw err;
    }
  `),
  "@tanstack/react-query": moduleUrl(`
    export function useQuery(options) {
      const f = globalThis.__adminUsageRouteFixture;
      f.requests.push(options);
      const key = options.queryKey[0];
      return f.queries[key] ?? {
        data: undefined,
        dataUpdatedAt: 0,
        isLoading: false,
        isFetching: false,
        isError: false,
        error: null,
        refetch: async () => {},
      };
    }
    export function useMutation() { return { mutate() {}, isPending: false }; }
    export function useQueryClient() { return { invalidateQueries() {} }; }
  `),
  "@/lib/api": moduleUrl(
    "export const api = { me: async () => null, adminUsage: async () => null, adminUsageUser: async () => null, adminUsers: async () => [], adminStorage: async () => null, adminInvites: async () => [], adminStatus: async () => null };",
  ),
  "@/lib/format": moduleUrl(
    "export const formatTime = (sec) => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;",
  ),
  "@/lib/morph": moduleUrl("export const NAV_LATERAL = ['nav-lateral'];"),
  "@/lib/slugs": moduleUrl("export const playlistPath = (p) => `/playlist/${p.id}`;"),
  "@/hooks/useDialogFocus": moduleUrl("export function useDialogFocus() {}"),
  "@/hooks/useAuth": moduleUrl(`
    export const useMe = () => {
      const f = globalThis.__adminUsageRouteFixture;
      return f.meQuery ?? { data: f.me, isLoading: false, isFetching: false, error: null, refetch: async () => {} };
    };
  `),
  "@/hooks/useLibrary": moduleUrl("export const usePlaylists = () => ({ data: [], isSuccess: true, isPending: false, isError: false }); export const useDeletePlaylist = () => ({ mutate() {} }); export const useAddToPlaylist = () => ({ mutate() {} });"),
  "@/lib/trackDrag": moduleUrl("export const TRACK_DRAG_MIME = 'application/x-loggerythm-track'; export const parseDraggedTrack = () => null;"),
  "@/hooks/useSearchNavigation": moduleUrl("export const useSearchNavigation = () => ({ input: '', setInput() {}, submit() {}, clear() {}, setComposing() {} });"),
  "@/store/player": moduleUrl("export const usePlayerStore = (sel) => sel({ isPlaying: false, queueContext: null });"),
  "@/store/toast": moduleUrl("export const toast = { success() {}, error() {} };"),
  "@/components/icons": iconStub,
  "@/components/feedbackIcons": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export function CopyIcon() { return createElement('svg'); }`,
  ),
  "@/components/Logo": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function Logo() { return createElement('span'); } export function Wordmark() { return createElement('span', null, 'LoggeRythm'); }`,
  ),
  "@/components/SearchField": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function SearchField() { return createElement('input'); }`,
  ),
  "@/components/ContextMenu": moduleUrl("export default function ContextMenu() { return null; }"),
  "@/components/CoverPlaceholder": moduleUrl("export default function CoverPlaceholder() { return null; }"),
  "@/components/ConfirmDialog": moduleUrl("export default function ConfirmDialog() { return null; }"),
  "@/app/library/CreatePlaylistDialog": moduleUrl(
    "export default function CreatePlaylistDialog() { return null; }",
  ),
  "@/app/playlist/_components/LeavePlaylistDialog": moduleUrl(
    "export default function LeavePlaylistDialog() { return null; }",
  ),
  "@/components/EqualizerBars": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function EqualizerBars() { return createElement('span', { 'data-eq': 'true' }); }`,
  ),
  "@/components/profile/ListeningStats": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function ListeningStats() { return createElement('div', null, 'Hörprofil-Inhalt'); }`,
  ),
  "./ProfileHeader": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function ProfileHeader({ me }) { return createElement('header', null, me.display_name || me.email); }`,
  ),
  "./PlaybackTab": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function PlaybackTab() { return createElement('div', null, 'Wiedergabe-Inhalt'); }`,
  ),
  "./ProfileTab": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function ProfileTab() { return createElement('div', null, 'Profil-Inhalt'); }`,
  ),
};

await compileInto(stubs, [
  ["@/lib/playlistPermissions", "src/lib/playlistPermissions.ts"],
  ["@/lib/adminUsage", "src/lib/adminUsage.ts"],
  ["@/components/Avatar", "src/components/Avatar.tsx"],
  ["@/components/ui/Cover", "src/components/ui/Cover.tsx"],
  ["@/components/ui/EmptyState", "src/components/ui/EmptyState.tsx"],
  ["@/components/shell/navigation", "src/components/shell/navigation.ts"],
  ["@/app/account/presentation", "src/app/account/presentation.tsx"],
  ["./sections", "src/app/account/_admin/sections.ts"],
  ["@/app/account/_admin/sections", "src/app/account/_admin/sections.ts"],
  ["./_admin/sections", "src/app/account/_admin/sections.ts"],
  ["./statusIcons", "src/app/account/_admin/statusIcons.tsx"],
  ["./_admin/statusIcons", "src/app/account/_admin/statusIcons.tsx"],
  ["./statusModel", "src/app/account/_admin/statusModel.ts"],
  ["./statusParts", "src/app/account/_admin/statusParts.tsx"],
  ["./StatusOverview", "src/app/account/_admin/StatusOverview.tsx"],
  ["./UsageOverviewKpis", "src/app/account/_admin/UsageOverviewKpis.tsx"],
  ["./UserUsageTable", "src/app/account/_admin/UserUsageTable.tsx"],
  ["./UserUsageDrawer", "src/app/account/_admin/UserUsageDrawer.tsx"],
  ["./_admin/UsageSection", "src/app/account/_admin/UsageSection.tsx"],
  ["./_admin/UsersAndInvitesSection", "src/app/account/_admin/UsersAndInvitesSection.tsx"],
  ["./_admin/StorageSection", "src/app/account/_admin/StorageSection.tsx"],
  ["./_admin/StatusSection", "src/app/account/_admin/StatusSection.tsx"],
  ["./AdministrationTab", "src/app/account/AdministrationTab.tsx"],
]);

const { default: UserUsageTable } = await import(stubs["./UserUsageTable"]);
const { default: AccountPage } = await import(
  await compileSource("src/app/account/page.tsx", stubs)
);
const { default: LegacyAdminUsagePage } = await import(
  await compileSource("src/app/admin/usage/page.tsx", stubs)
);
const { default: LegacyStatusPage } = await import(
  await compileSource("src/app/status/page.tsx", stubs)
);
const { default: Sidebar } = await import(
  await compileSource("src/components/shell/Sidebar.tsx", stubs)
);
const { default: TopBar } = await import(
  await compileSource("src/components/shell/TopBar.tsx", stubs)
);

const sampleOverview = {
  range: "all",
  generated_at: "2026-11-24T10:00:00Z",
  request_tracking_since: "2026-10-01T00:00:00Z",
  overview: {
    total_users: 2,
    approved_users: 2,
    pending_users: 0,
    active_users: 2,
    total_plays: 420,
    total_listening_sec: 86400,
    unique_tracks_played: 130,
    tracks_requested: 95,
    tracks_materialized: 64,
    materialized_bytes: 480_000_000,
    online_connect_devices: 2,
    online_connect_users: 2,
    active_parties: 1,
    storage: {
      cached_tracks: 110,
      total_audio_bytes: 900_000_000,
      exclusive_audio_bytes: 500_000_000,
      exclusive_audio_tracks: 60,
      shared_audio_bytes: 320_000_000,
      shared_audio_tracks: 40,
      unattributed_audio_bytes: 80_000_000,
      unattributed_audio_tracks: 10,
      directly_attributed_tracks: 64,
      directly_attributed_bytes: 480_000_000,
      upload_bytes: 2_500_000,
      disk_total: 64_000_000_000,
      disk_used: 20_000_000_000,
      disk_free: 44_000_000_000,
      retention_days: 30,
    },
  },
  users: [
    {
      id: "1",
      email: "admin@test",
      display_name: "Admin",
      avatar_url: null,
      is_admin: true,
      is_approved: true,
      created_at: "2026-01-04T10:00:00Z",
      last_active_at: "2026-11-24T09:55:00Z",
      plays: 300,
      listening_sec: 60000,
      unique_tracks: 90,
      tracks_requested: 60,
      tracks_materialized: 40,
      materialized_bytes: 300_000_000,
      storage: {
        exclusive_bytes: 320_000_000,
        exclusive_tracks: 38,
        shared_bytes: 320_000_000,
        shared_tracks: 40,
        accessed_bytes: 640_000_000,
        accessed_tracks: 78,
        materialized_bytes: 300_000_000,
        materialized_tracks: 40,
        pinned_bytes: 210_000_000,
        pinned_tracks: 28,
        upload_bytes: 2_000_000,
      },
      library: {
        likes: 25,
        playlists: 4,
        public_playlists: 2,
        playlist_tracks: 80,
        follows: 7,
        party_tracks_added: 12,
        party_hosted: 2,
        import_jobs: 2,
        import_tracks_matched: 45,
      },
      online_devices: 1,
      is_playing_now: true,
      active_device_name: "Studio Mac",
      active_party_code: "JAM99",
    },
    {
      id: "2",
      email: "jule@test",
      display_name: "Jule",
      avatar_url: null,
      is_admin: false,
      is_approved: true,
      created_at: "2026-03-11T18:20:00Z",
      last_active_at: "2026-11-24T08:00:00Z",
      plays: 120,
      listening_sec: 26400,
      unique_tracks: 40,
      tracks_requested: 35,
      tracks_materialized: 24,
      materialized_bytes: 180_000_000,
      storage: {
        exclusive_bytes: 180_000_000,
        exclusive_tracks: 22,
        shared_bytes: 320_000_000,
        shared_tracks: 40,
        accessed_bytes: 500_000_000,
        accessed_tracks: 62,
        materialized_bytes: 180_000_000,
        materialized_tracks: 24,
        pinned_bytes: 110_000_000,
        pinned_tracks: 15,
        upload_bytes: 500_000,
      },
      library: {
        likes: 14,
        playlists: 2,
        public_playlists: 1,
        playlist_tracks: 30,
        follows: 3,
        party_tracks_added: 8,
        party_hosted: 0,
        import_jobs: 1,
        import_tracks_matched: 18,
      },
      online_devices: 1,
      is_playing_now: false,
      active_device_name: "Pixel 9",
      active_party_code: null,
    },
  ],
};

const sampleDetail = {
  range: "all",
  generated_at: "2026-11-24T10:00:00Z",
  request_tracking_since: "2026-10-01T00:00:00Z",
  user: sampleOverview.users[1],
  storage_breakdown: {
    ...sampleOverview.users[1].storage,
    total_cache_bytes: 900_000_000,
  },
  requests_by_source: [
    { source: "stream", requests: 25, materialized: 16, materialized_bytes: 120_000_000 },
    { source: "party_preload", requests: 10, materialized: 8, materialized_bytes: 60_000_000 },
  ],
  active_devices: [
    {
      device_id: "pixel-9",
      name: "Pixel 9",
      device_type: "mobile",
      is_active: true,
      party_code: "JAM99",
      connected_at: "2026-11-24T09:00:00Z",
      last_seen_at: "2026-11-24T09:59:00Z",
    },
  ],
  top_tracks: [{ key: "901", label: "Laternen", sublabel: "Nachtfalter", cover: "", count: 18 }],
  top_artists: [{ key: "100", label: "Nachtfalter", sublabel: "", cover: "", count: 42 }],
  recent_plays: [
    {
      id: "901",
      title: "Laternen",
      artist: "Nachtfalter",
      album: "Neonregen",
      cover: "",
      duration_sec: 210,
      played_at: "2026-11-24T09:30:00Z",
    },
  ],
  recent_requests: [
    {
      deezer_id: "901",
      title: "Laternen",
      artist: "Nachtfalter",
      cover: "",
      source: "party_preload",
      materialized: true,
      size_bytes: 7_500_000,
      requested_at: "2026-11-24T09:29:00Z",
      is_currently_stored: true,
    },
    {
      deezer_id: "902",
      title: "Nebelhorn",
      artist: "Velvet Motor",
      cover: "",
      source: "stream",
      materialized: false,
      size_bytes: 6_200_000,
      requested_at: "2026-11-24T09:10:00Z",
      is_currently_stored: false,
    },
  ],
};

const sampleStatus = {
  deezer: { arl_configured: true, arl_ok: true, quality: "mp3" },
  storage: {
    track_count: 110,
    total_bytes: 900_000_000,
    disk_total: 64_000_000_000,
    disk_used: 20_000_000_000,
    disk_free: 44_000_000_000,
    retention_days: 30,
    cleanup_stopped_at: null,
    cleanup_error: null,
  },
  users: { total: 3, approved: 2, pending: 1, admins: 1 },
  content: {
    playlists: 4,
    likes: 25,
    follows: 7,
    plays: 420,
    stored_lyrics: 32,
    parties: 1,
    invites_total: 2,
    invites_used: 1,
  },
  integrations: { spotify_configured: true, lastfm_configured: false, mail_configured: true },
  system: { app_env: "production", database: "postgresql", jwt_secure: true, cookie_secure: true },
};

function renderAccount() {
  fixture.requests = [];
  return renderToStaticMarkup(createElement(AccountPage));
}

test("non-admin visiting /account?tab=admin sees explicit access-denied state without admin queries", () => {
  fixture.meQuery = null;
  fixture.me = { id: 2, email: "jule@test", display_name: "Jule", is_admin: false, is_approved: true };
  fixture.searchParams = new URLSearchParams("tab=admin&section=usage");
  fixture.queries = {};

  const html = renderAccount();
  assert.match(html, /Nur für Administratoren/);
  assert.match(html, /Zum Hörprofil/);
  assert.doesNotMatch(html, /account-tab-admin/);
  assert.doesNotMatch(html, /Hörprofil-Inhalt/);
  assert.equal(fixture.requests.length, 0);
});

test("account auth error renders loud alert with retry button", () => {
  fixture.meQuery = {
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: new Error("API /auth/me: HTTP 503"),
    refetch: async () => {},
  };
  fixture.searchParams = new URLSearchParams("tab=admin");
  const html = renderAccount();
  fixture.meQuery = null;

  assert.match(html, /role="alert"/);
  assert.match(html, /Konto konnte nicht geladen werden/);
  assert.match(html, /API \/auth\/me: HTTP 503/);
  assert.match(html, /Erneut versuchen/);
});

test("admin hub widens to max-w-6xl, renders 4 sub-sections, and defaults to Usage with KPIs & drawer", () => {
  fixture.meQuery = null;
  fixture.me = { id: 1, email: "admin@test", display_name: "Admin", is_admin: true, is_approved: true };
  fixture.searchParams = new URLSearchParams("tab=admin&range=all&user=2");
  fixture.queries = {
    "admin-usage": {
      data: sampleOverview,
      dataUpdatedAt: Date.parse("2026-11-24T10:00:00Z"),
      isLoading: false,
      isFetching: false,
      error: null,
    },
    "admin-usage-user": {
      data: sampleDetail,
      isLoading: false,
      isFetching: false,
      error: null,
    },
  };

  const html = renderAccount();
  assert.match(html, /max-w-6xl/);
  assert.match(html, /admin-section-tab-usage/);
  assert.match(html, /admin-section-tab-users/);
  assert.match(html, /admin-section-tab-storage/);
  assert.match(html, /admin-section-tab-status/);
  assert.match(html, /Nutzungsübersicht/);
  assert.match(html, /7 Tage/);
  assert.match(html, /30 Tage/);
  assert.match(html, /Gesamt/);
  assert.match(html, /Speicherverteilung im Audio-Cache/);
  assert.match(html, /Direkt zugeordnet:/);
  assert.match(html, /Studio Mac/);
  assert.match(html, /Jam JAM99/);
  // Drill-down drawer
  assert.match(html, /role="dialog"/);
  assert.match(html, /Aktive Connect-Geräte/);
  assert.match(html, /Anfragen nach Quelle/);
  assert.match(html, /Jam-Preload/);
  assert.match(html, /Neu geladen/);
  assert.match(html, /Cache-Treffer/);
  assert.match(html, /Im Cache/);
  assert.match(html, /Entfernt/);
  assert.match(html, /Laternen/);
});

test("non-admin account tabs stay compact at max-w-5xl", () => {
  fixture.meQuery = null;
  fixture.me = { id: 1, email: "admin@test", display_name: "Admin", is_admin: true, is_approved: true };
  fixture.searchParams = new URLSearchParams("tab=stats");
  const html = renderAccount();
  assert.match(html, /max-w-5xl/);
  assert.doesNotMatch(html, /max-w-6xl/);
});

test("overview and drawer API errors fail loudly and stale refresh keeps last snapshot with warning", () => {
  fixture.meQuery = null;
  fixture.me = { id: 1, email: "admin@test", display_name: "Admin", is_admin: true, is_approved: true };
  fixture.searchParams = new URLSearchParams("tab=admin&section=usage");
  fixture.queries = {
    "admin-usage": {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("API /admin/usage: HTTP 500"),
    },
  };
  const initialErr = renderAccount();
  assert.match(initialErr, /role="alert"/);
  assert.match(initialErr, /Die Nutzungsdaten konnten nicht geladen werden\./);
  assert.match(initialErr, /API \/admin\/usage: HTTP 500/);
  assert.match(initialErr, /Erneut versuchen/);

  fixture.searchParams = new URLSearchParams("tab=admin&section=usage&range=30d&user=2");
  fixture.queries = {
    "admin-usage": {
      data: sampleOverview,
      dataUpdatedAt: Date.parse("2026-11-24T10:00:00Z"),
      isLoading: false,
      isFetching: false,
      error: new Error("API /admin/usage: Zeitüberschreitung"),
    },
    "admin-usage-user": {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("API /admin/usage/users/2: HTTP 404"),
    },
  };
  const staleAndDrawerErr = renderAccount();
  assert.match(staleAndDrawerErr, /Daten veraltet/);
  assert.match(staleAndDrawerErr, /Zeitüberschreitung/);
  assert.match(staleAndDrawerErr, /Speicherverteilung im Audio-Cache/);
  assert.match(staleAndDrawerErr, /Benutzerdetails konnten nicht geladen werden: API \/admin\/usage\/users\/2: HTTP 404/);
  assert.doesNotMatch(staleAndDrawerErr, /Anfragen nach Quelle/);
});

test("admin hub renders Users & Invites, Storage, and inline Systemstatus sections with in-hub links", () => {
  fixture.meQuery = null;
  fixture.me = { id: 1, email: "admin@test", display_name: "Admin", is_admin: true, is_approved: true };

  fixture.searchParams = new URLSearchParams("tab=admin&section=users");
  fixture.queries = {
    "admin-users": {
      data: [{ id: 2, email: "jule@test", display_name: "Jule", is_admin: false, is_approved: false, created_at: "2026-03-11T18:20:00Z" }],
      isLoading: false,
      isFetching: false,
      error: null,
    },
    "admin-invites": { data: [], isLoading: false, isFetching: false, error: null },
  };
  const usersHtml = renderAccount();
  assert.match(usersHtml, /Einladungslinks/);
  assert.match(usersHtml, /Freigeben/);

  fixture.searchParams = new URLSearchParams("tab=admin&section=storage");
  fixture.queries = {
    "admin-storage": {
      data: { track_count: 110, total_bytes: 900_000_000, disk_total: 64_000_000_000, disk_used: 20_000_000_000, disk_free: 44_000_000_000, retention_days: 30, tracks: [] },
      isLoading: false,
      isFetching: false,
      error: null,
    },
  };
  const storageHtml = renderAccount();
  assert.match(storageHtml, /Jetzt aufräumen/);
  assert.match(storageHtml, /Belegt durch Titel/);

  fixture.searchParams = new URLSearchParams("tab=admin&section=status");
  fixture.queries = {
    "admin-status": {
      data: sampleStatus,
      dataUpdatedAt: Date.parse("2026-11-24T10:00:00Z"),
      isLoading: false,
      isFetching: false,
      error: null,
    },
  };
  const statusHtml = renderAccount();
  assert.match(statusHtml, /Alle Kernsysteme laufen/);
  assert.match(statusHtml, /href="\/account\?tab=admin&amp;section=storage"/);
  assert.match(statusHtml, /href="\/account\?tab=admin&amp;section=users"/);
});

test("null display_name and created_at render cleanly and combined headers reflect aria-sort", () => {
  const sparseUser = {
    ...sampleOverview.users[1],
    display_name: null,
    created_at: null,
  };
  const sparseOverview = {
    ...sampleOverview,
    users: [sampleOverview.users[0], sparseUser],
  };
  const sparseDetail = {
    ...sampleDetail,
    user: sparseUser,
    top_artists: [{ key: "", label: "Legacy Artist", sublabel: "", cover: "", count: 7 }],
  };

  fixture.meQuery = null;
  fixture.me = { id: 1, email: "admin@test", display_name: "Admin", is_admin: true, is_approved: true };
  fixture.searchParams = new URLSearchParams("tab=admin&section=usage&range=all&user=2");
  fixture.queries = {
    "admin-usage": {
      data: sparseOverview,
      dataUpdatedAt: Date.parse("2026-11-24T10:00:00Z"),
      isLoading: false,
      isFetching: false,
      error: null,
    },
    "admin-usage-user": {
      data: sparseDetail,
      isLoading: false,
      isFetching: false,
      error: null,
    },
  };
  const html = renderAccount();
  assert.match(html, /Details für jule@test öffnen/);
  assert.match(html, /Legacy Artist/);
  assert.doesNotMatch(html, /Invalid Date/);
  assert.doesNotMatch(html, /Mitglied seit/);

  const tableHtmlListening = renderToStaticMarkup(
    createElement(UserUsageTable, {
      users: [sparseUser],
      totalUsersCount: 1,
      totalCacheBytes: 900_000_000,
      selectedUserId: null,
      sortKey: "listening_sec",
      sortDir: "asc",
      searchQuery: "",
      onSort: () => {},
      onSelectUser: () => {},
      onResetSearch: () => {},
    }),
  );
  assert.match(tableHtmlListening, /<th scope="col" aria-sort="ascending"[^>]*>.*Wiedergaben.*Hörzeit/);
  assert.doesNotMatch(tableHtmlListening, /seit /);

  const tableHtmlAccessed = renderToStaticMarkup(
    createElement(UserUsageTable, {
      users: [sparseUser],
      totalUsersCount: 1,
      totalCacheBytes: 900_000_000,
      selectedUserId: null,
      sortKey: "accessed_bytes",
      sortDir: "desc",
      searchQuery: "",
      onSort: () => {},
      onSelectUser: () => {},
      onResetSearch: () => {},
    }),
  );
  assert.match(tableHtmlAccessed, /<th scope="col" aria-sort="descending"[^>]*>.*Speicher exkl\..*Gesamt/);
});

test("Sidebar and TopBar keep primary navigation free of admin shortcuts even for admins", () => {
  fixture.meQuery = null;
  fixture.me = { id: 1, display_name: "Admin", is_admin: true, is_approved: true };
  const sidebarHtml = renderToStaticMarkup(createElement(Sidebar));
  const topBarHtml = renderToStaticMarkup(createElement(TopBar));

  assert.doesNotMatch(sidebarHtml, /href="\/admin\/usage"/);
  assert.doesNotMatch(sidebarHtml, /href="\/status"/);
  assert.doesNotMatch(topBarHtml, /href="\/admin\/usage"/);
  assert.doesNotMatch(topBarHtml, /href="\/status"/);
  assert.match(topBarHtml, /href="\/account"/);
});

test("legacy /admin/usage and /status routes redirect cleanly into /account?tab=admin preserving query params", async () => {
  fixture.redirects = [];
  await assert.rejects(
    () => LegacyAdminUsagePage({ searchParams: Promise.resolve({ range: "7d", user: "2" }) }),
    /NEXT_REDIRECT:\/account\?tab=admin&section=usage&range=7d&user=2/,
  );

  fixture.redirects = [];
  await assert.rejects(
    () => LegacyAdminUsagePage({ searchParams: Promise.resolve({ range: "invalid", user: "  " }) }),
    /NEXT_REDIRECT:\/account\?tab=admin&section=usage/,
  );

  fixture.redirects = [];
  assert.throws(
    () => LegacyStatusPage(),
    /NEXT_REDIRECT:\/account\?tab=admin&section=status/,
  );
});
