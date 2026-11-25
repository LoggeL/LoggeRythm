import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";

const reactUrl = import.meta.resolve("react");

const fixture = {
  pathname: "/admin/usage",
  searchParams: new URLSearchParams(),
  me: { id: 1, email: "admin@test", display_name: "Admin", is_admin: true, is_approved: true },
  requests: [],
  queries: {},
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
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
  "next/link": moduleUrl(
    `import { createElement } from ${JSON.stringify(reactUrl)}; export default function Link({ href, children, ...props }) { return createElement('a', { ...props, href }, children); }`,
  ),
  "next/navigation": moduleUrl(`
    export function useRouter() { return { replace() {}, push() {}, back() {}, forward() {} }; }
    export function useSearchParams() { return globalThis.__adminUsageRouteFixture.searchParams; }
    export function usePathname() { return globalThis.__adminUsageRouteFixture.pathname; }
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
  "@/lib/api": moduleUrl("export const api = { me: async () => null, adminUsage: async () => null, adminUsageUser: async () => null };"),
  "@/lib/format": moduleUrl("export const formatTime = (sec) => `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`;"),
  "@/lib/morph": moduleUrl("export const NAV_LATERAL = ['nav-lateral'];"),
  "@/lib/slugs": moduleUrl("export const playlistPath = (p) => `/playlist/${p.id}`;"),
  "@/hooks/useDialogFocus": moduleUrl("export function useDialogFocus() {}"),
  "@/hooks/useAuth": moduleUrl("export const useMe = () => ({ data: globalThis.__adminUsageRouteFixture.me });"),
  "@/hooks/useLibrary": moduleUrl("export const usePlaylists = () => ({ data: [], isSuccess: true, isPending: false, isError: false }); export const useDeletePlaylist = () => ({ mutate() {} }); export const useAddToPlaylist = () => ({ mutate() {} });"),
  "@/lib/trackDrag": moduleUrl("export const TRACK_DRAG_MIME = 'application/x-loggerythm-track'; export const parseDraggedTrack = () => null;"),
  "@/hooks/useSearchNavigation": moduleUrl("export const useSearchNavigation = () => ({ input: '', setInput() {}, submit() {}, clear() {}, setComposing() {} });"),
  "@/store/player": moduleUrl("export const usePlayerStore = (sel) => sel({ isPlaying: false, queueContext: null });"),
  "@/store/toast": moduleUrl("export const toast = { success() {}, error() {} };"),
  "@/components/icons": iconStub,
  "@/components/feedbackIcons": moduleUrl(`import { createElement } from ${JSON.stringify(reactUrl)}; export function CopyIcon() { return createElement('svg'); }`),
  "@/components/Logo": moduleUrl(`import { createElement } from ${JSON.stringify(reactUrl)}; export default function Logo() { return createElement('span'); } export function Wordmark() { return createElement('span', null, 'LoggeRythm'); }`),
  "@/components/SearchField": moduleUrl(`import { createElement } from ${JSON.stringify(reactUrl)}; export default function SearchField() { return createElement('input'); }`),
  "@/components/ContextMenu": moduleUrl("export default function ContextMenu() { return null; }"),
  "@/components/CoverPlaceholder": moduleUrl("export default function CoverPlaceholder() { return null; }"),
  "@/components/ConfirmDialog": moduleUrl("export default function ConfirmDialog() { return null; }"),
  "@/app/library/CreatePlaylistDialog": moduleUrl("export default function CreatePlaylistDialog() { return null; }"),
  "@/app/playlist/_components/LeavePlaylistDialog": moduleUrl("export default function LeavePlaylistDialog() { return null; }"),
  "@/components/EqualizerBars": moduleUrl(`import { createElement } from ${JSON.stringify(reactUrl)}; export default function EqualizerBars() { return createElement('span', { 'data-eq': 'true' }); }`),
};

await compileInto(stubs, [
  ["@/lib/adminUsage", "src/lib/adminUsage.ts"],
  ["@/lib/playlistPermissions", "src/lib/playlistPermissions.ts"],
  ["@/components/Avatar", "src/components/Avatar.tsx"],
  ["@/components/ui/Cover", "src/components/ui/Cover.tsx"],
  ["@/components/ui/EmptyState", "src/components/ui/EmptyState.tsx"],
  ["@/components/shell/navigation", "src/components/shell/navigation.ts"],
  ["@/app/account/presentation", "src/app/account/presentation.tsx"],
  ["./presentation", "src/app/account/presentation.tsx"],
  ["./UsageOverviewKpis", "src/app/admin/usage/UsageOverviewKpis.tsx"],
  ["./UserUsageTable", "src/app/admin/usage/UserUsageTable.tsx"],
  ["./UserUsageDrawer", "src/app/admin/usage/UserUsageDrawer.tsx"],
]);

const { default: UserUsageTable } = await import(stubs["./UserUsageTable"]);
const { default: AdminUsagePage } = await import(
  await compileSource("src/app/admin/usage/page.tsx", stubs)
);
const { default: Sidebar } = await import(
  await compileSource("src/components/shell/Sidebar.tsx", stubs)
);
const { default: TopBar } = await import(
  await compileSource("src/components/shell/TopBar.tsx", stubs)
);
const { default: AdministrationTab } = await import(
  await compileSource("src/app/account/AdministrationTab.tsx", stubs)
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

function renderUsagePage() {
  fixture.requests = [];
  return renderToStaticMarkup(createElement(AdminUsagePage));
}

test("non-admin sees explicit access-denied state and usage query stays disabled", () => {
  fixture.searchParams = new URLSearchParams();
  fixture.queries = {
    "admin-usage-auth": {
      data: { id: 2, email: "jule@test", display_name: "Jule", is_admin: false },
      isLoading: false,
      isFetching: false,
      error: null,
    },
  };
  const html = renderUsagePage();
  assert.match(html, /Nur für Administratoren/);
  assert.match(html, /Zur Startseite/);
  const usageReq = fixture.requests.find((r) => r.queryKey[0] === "admin-usage");
  assert.ok(usageReq);
  assert.equal(usageReq.enabled, false);
});

test("auth check error renders loud alert with retry button", () => {
  fixture.searchParams = new URLSearchParams();
  fixture.queries = {
    "admin-usage-auth": {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("API /auth/me: HTTP 503"),
    },
  };
  const html = renderUsagePage();
  assert.match(html, /role="alert"/);
  assert.match(html, /Berechtigung konnte nicht geprüft werden/);
  assert.match(html, /API \/auth\/me: HTTP 503/);
  assert.match(html, /Erneut prüfen/);
});

test("overview API error fails loudly and preserves stale snapshot with warning", () => {
  fixture.searchParams = new URLSearchParams();
  fixture.queries = {
    "admin-usage-auth": {
      data: { id: 1, email: "admin@test", display_name: "Admin", is_admin: true },
      isLoading: false,
      isFetching: false,
      error: null,
    },
    "admin-usage": {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("API /admin/usage: HTTP 500"),
    },
  };
  const initialErr = renderUsagePage();
  assert.match(initialErr, /role="alert"/);
  assert.match(initialErr, /Die Nutzungsdaten konnten nicht geladen werden\./);
  assert.match(initialErr, /API \/admin\/usage: HTTP 500/);
  assert.match(initialErr, /Erneut versuchen/);

  fixture.queries["admin-usage"] = {
    data: sampleOverview,
    dataUpdatedAt: Date.parse("2026-11-24T10:00:00Z"),
    isLoading: false,
    isFetching: false,
    error: new Error("API /admin/usage: Zeitüberschreitung"),
  };
  const staleErr = renderUsagePage();
  assert.match(staleErr, /Daten veraltet/);
  assert.match(staleErr, /Zeitüberschreitung/);
  assert.match(staleErr, /Speicherverteilung im Audio-Cache/);
});

test("admin dashboard renders KPIs, storage attribution, users, and drill-down drawer", () => {
  fixture.searchParams = new URLSearchParams("range=all&user=2");
  fixture.queries = {
    "admin-usage-auth": {
      data: { id: 1, email: "admin@test", display_name: "Admin", is_admin: true },
      isLoading: false,
      isFetching: false,
      error: null,
    },
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
  const html = renderUsagePage();
  assert.match(html, /Nutzungs-Dashboard/);
  assert.match(html, /7 Tage/);
  assert.match(html, /30 Tage/);
  assert.match(html, /Gesamt/);
  assert.match(html, /Speicherverteilung im Audio-Cache/);
  assert.match(html, /Direkt zugeordnet:/);
  assert.match(html, /Studio Mac/);
  assert.match(html, /Jam JAM99/);
  // Drawer content
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

test("drill-down drawer surfaces detail fetch error loudly without silent fallback", () => {
  fixture.searchParams = new URLSearchParams("range=30d&user=2");
  fixture.queries = {
    "admin-usage-auth": {
      data: { id: 1, email: "admin@test", display_name: "Admin", is_admin: true },
      isLoading: false,
      isFetching: false,
      error: null,
    },
    "admin-usage": {
      data: sampleOverview,
      dataUpdatedAt: Date.parse("2026-11-24T10:00:00Z"),
      isLoading: false,
      isFetching: false,
      error: null,
    },
    "admin-usage-user": {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: new Error("API /admin/usage/users/2: HTTP 404"),
    },
  };
  const html = renderUsagePage();
  assert.match(html, /role="dialog"/);
  assert.match(html, /Benutzerdetails konnten nicht geladen werden: API \/admin\/usage\/users\/2: HTTP 404/);
  assert.doesNotMatch(html, /Anfragen nach Quelle/);
});

test("null display_name and created_at render cleanly in table & drawer and combined headers reflect aria-sort", () => {
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

  fixture.searchParams = new URLSearchParams("range=all&user=2");
  fixture.queries = {
    "admin-usage-auth": {
      data: { id: 1, email: "admin@test", display_name: "Admin", is_admin: true },
      isLoading: false,
      isFetching: false,
      error: null,
    },
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
  const html = renderUsagePage();
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

test("Sidebar, TopBar and AdministrationTab expose /admin/usage exclusively to admins", () => {
  fixture.me = { id: 1, display_name: "Admin", is_admin: true };
  assert.match(renderToStaticMarkup(createElement(Sidebar)), /href="\/admin\/usage"/);
  assert.match(renderToStaticMarkup(createElement(TopBar)), /href="\/admin\/usage"/);
  assert.match(renderToStaticMarkup(createElement(AdministrationTab)), /href="\/admin\/usage"/);
  assert.match(renderToStaticMarkup(createElement(AdministrationTab)), /href="\/status"/);

  fixture.me = { id: 2, display_name: "Jule", is_admin: false };
  assert.doesNotMatch(renderToStaticMarkup(createElement(Sidebar)), /href="\/admin\/usage"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(TopBar)), /href="\/admin\/usage"/);
});
