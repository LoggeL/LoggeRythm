import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";
import {
  canEditPlaylistTracks,
  isOwnedLibraryPlaylist,
  libraryPlaylistSubtitle,
  playlistHeroEyebrow,
  playlistMemberCount,
  sidebarPlaylistMeta,
} from "../src/lib/playlistPermissions.ts";

const fixture = {
  playlist: null,
  invitePreview: null,
  acceptState: { isPending: false, isError: false, error: null, mutate() {} },
  addModal: {
    track: null,
    session: 1,
    me: { id: 1, display_name: "Demo" },
    playlists: null,
  },
};
globalThis.__collabFixture = fixture;

const reactUrl = import.meta.resolve("react");
const jsxUrl = import.meta.resolve("react/jsx-runtime");
const nextLinkUrl = moduleUrl(
  `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Link({href, children, ...props}) { return createElement("a", {...props, href}, children); }`,
);
const emptyIcon = `() => null`;
const iconsStub = moduleUrl(`
  export const MusicNoteIcon = ${emptyIcon};
  export const UsersIcon = ${emptyIcon};
  export const DownloadIcon = ${emptyIcon};
  export const DownloadedIcon = ${emptyIcon};
  export const EditIcon = ${emptyIcon};
  export const GlobeIcon = ${emptyIcon};
  export const ImageIcon = ${emptyIcon};
  export const ImportIcon = ${emptyIcon};
  export const LockIcon = ${emptyIcon};
  export const LogOutIcon = ${emptyIcon};
  export const SpinnerIcon = ${emptyIcon};
  export const TrashIcon = ${emptyIcon};
  export const PlayIcon = ${emptyIcon};
  export const PauseIcon = ${emptyIcon};
  export const ShuffleIcon = ${emptyIcon};
  export const MoreIcon = ${emptyIcon};
  export const QueueIcon = ${emptyIcon};
  export const GripIcon = ${emptyIcon};
  export const PlusIcon = ${emptyIcon};
  export const CloseIcon = ${emptyIcon};
`);
const feedbackIconsStub = moduleUrl(`
  export const InfoCircleIcon = ${emptyIcon};
  export const CheckCircleIcon = ${emptyIcon};
  export const CopyIcon = ${emptyIcon};
`);
const collectionStyleStub = moduleUrl(
  `export default ${JSON.stringify({
    hero: "hero",
    artwork: "artwork",
    roundArtwork: "round",
    info: "info",
    title: "title",
    description: "description",
    metadata: "metadata",
    actions: "actions",
    tracks: "tracks",
    trackHeading: "track-heading",
    trackCount: "track-count",
    wash: "wash",
    coverEdit: "cover-edit",
  })};`,
);

class FakeApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
globalThis.__FakeApiError = FakeApiError;

const commonStubs = {
  react: moduleUrl(
    `import * as R from ${JSON.stringify(reactUrl)}; export default R; export const use = (v) => v; export const useEffect = () => {}; export const useRef = R.useRef; export const useState = R.useState; export const useId = R.useId; export const useMemo = R.useMemo; export const useDeferredValue = (v) => v;`,
  ),
  "react/jsx-runtime": jsxUrl,
  "next/link": nextLinkUrl,
  "next/navigation": moduleUrl(
    `export const useRouter = () => ({ push() {}, replace() {} });`,
  ),
  "@/components/icons": iconsStub,
  "@/components/feedbackIcons": feedbackIconsStub,
  "@/components/CoverPlaceholder": moduleUrl(
    `export default function CoverPlaceholder() { return null; }`,
  ),
  "@/components/Skeleton": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export const DetailHeaderSkeleton = () => createElement("span", {"data-testid": "loading"}); export const RowListSkeleton = DetailHeaderSkeleton;`,
  ),
  "@/components/ContextMenu": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function ContextMenu({items}) { return createElement("div", {"data-testid": "context-menu"}, items.map((i, idx) => createElement("span", {key: idx}, i.label))); }`,
  ),
  "@/components/motion/Morph": moduleUrl(
    `export const HeroMorph = ({children}) => children; export const useMorphSeed = () => null; export const useHeroRise = () => () => ({}); export const HeroEntrance = ({children}) => children;`,
  ),
  "@/components/TrackList": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export function TrackListHeader({reorderable, noteLabel}) { return createElement("div", {"data-testid": "track-header", "data-reorderable": String(Boolean(reorderable)), "data-note-label": noteLabel ?? ""}, noteLabel ?? ""); }`,
  ),
  "@/components/TrackRow": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function TrackRow({track, onRemove, dragHandle, note}) { return createElement("div", {"data-testid": "track-row", "data-removable": String(Boolean(onRemove)), "data-draggable": String(Boolean(dragHandle))}, track.title, note ? createElement("span", {"data-testid": "track-note"}, note) : null); }`,
  ),
  "@/components/trackList.module.css": moduleUrl(`export default { handle: "handle" };`),
  "@/components/Modal": moduleUrl(
    `import {createElement} from ${JSON.stringify(reactUrl)}; export default function Modal({open, title, children}) { return open ? createElement("div", {"data-testid": "modal", "data-title": title}, children) : null; }`,
  ),
  "@/hooks/useCoverColors": moduleUrl(`export const useCoverColors = () => null;`),
  "@/hooks/useFitWords": moduleUrl(`export const useFitWords = () => undefined;`),
  "@/hooks/useAuth": moduleUrl(
    `export const useMe = () => ({ data: globalThis.__collabFixture.addModal.me });`,
  ),
  "@/hooks/useLibrary": moduleUrl(`
    export const usePlaylist = () => globalThis.__collabFixture.playlist;
    export const usePlaylists = () => globalThis.__collabFixture.addModal.playlists;
    export const useAddToPlaylist = () => ({ isPending: false, mutate() {} });
    export const useCreatePlaylist = () => ({ isPending: false, mutate() {} });
    export const useRemoveFromPlaylist = () => ({ isPending: false, isError: false, error: null, mutate() {} });
    export const useReorderPlaylist = () => ({ isPending: false, isError: false, error: null, mutate() {} });
    export const usePlaylistInvitePreview = () => globalThis.__collabFixture.invitePreview;
    export const useAcceptPlaylistInvite = () => globalThis.__collabFixture.acceptState;
  `),
  "@/store/player": moduleUrl(
    `export const usePlayerStore = (selector) => selector({ playQueue() {}, toggle() {}, toggleShuffle() {}, addToQueue() {}, index: -1, queue: [], origins: [], queueContext: null, isPlaying: false, shuffle: false });`,
  ),
  "@/store/toast": moduleUrl(
    `export const toast = { success() {}, error() {}, info() {} };`,
  ),
  "@/store/addToPlaylist": moduleUrl(
    `export const useAddToPlaylistStore = (selector) => selector({ track: globalThis.__collabFixture.addModal.track, session: globalThis.__collabFixture.addModal.session, close() {} });`,
  ),
  "@/lib/api": moduleUrl(
    `export const ApiError = globalThis.__FakeApiError; export const playlistExportUrl = (id) => "/api/playlists/" + id + "/export";`,
  ),
  "./collection.module.css": collectionStyleStub,
  "./usePlaylistOffline": moduleUrl(
    `export const usePlaylistOffline = () => ({ supported: false, downloaded: false, pending: null, progress: null, toggle() {} });`,
  ),
  "./usePlaylistSettings": moduleUrl(
    `export const usePlaylistVisibility = () => ({ pending: false, toggle() {} }); export const usePlaylistCoverUpload = () => ({ uploading: false, upload() {} });`,
  ),
  "../_components/usePlaylistSettings": moduleUrl(
    `export const usePlaylistCoverUpload = () => ({ uploading: false, upload() {} });`,
  ),
  "../_components/DeletePlaylistDialog": moduleUrl(`export default function DeletePlaylistDialog() { return null; }`),
  "../_components/EditPlaylistDialog": moduleUrl(`export default function EditPlaylistDialog() { return null; }`),
  "../_components/CollaboratorsDialog": moduleUrl(`export default function CollaboratorsDialog() { return null; }`),
  "../_components/LeavePlaylistDialog": moduleUrl(`export default function LeavePlaylistDialog() { return null; }`),
};

await compileInto(
  commonStubs,
  [
    ["@/lib/slugs", "src/lib/slugs.ts"],
    ["@/lib/authRedirect", "src/lib/authRedirect.ts"],
    ["@/lib/playlistPermissions", "src/lib/playlistPermissions.ts"],
    ["@/components/Avatar", "src/components/Avatar.tsx"],
    ["@/components/ui/Cover", "src/components/ui/Cover.tsx"],
    ["@/components/ui/QueryError", "src/components/ui/QueryError.tsx"],
    ["@/components/ui/EmptyState", "src/components/ui/EmptyState.tsx"],
    ["./collectionPlayback", "src/app/playlist/_components/collectionPlayback.ts"],
    ["./collectionMeta", "src/app/playlist/_components/collectionMeta.ts"],
    ["../_components/collectionMeta", "src/app/playlist/_components/collectionMeta.ts"],
    ["./CollectionHero", "src/app/playlist/_components/CollectionHero.tsx"],
    ["../_components/CollectionHero", "src/app/playlist/_components/CollectionHero.tsx"],
    ["./CollectionActions", "src/app/playlist/_components/CollectionActions.tsx"],
    ["../_components/CollectionPageState", "src/app/playlist/_components/CollectionPageState.tsx"],
    ["../_components/CollectionTracks", "src/app/playlist/_components/CollectionTracks.tsx"],
    ["../_components/CollaboratorAvatars", "src/app/playlist/_components/CollaboratorAvatars.tsx"],
    ["../_components/PlaylistActions", "src/app/playlist/_components/PlaylistActions.tsx"],
    ["../_components/PlaylistCover", "src/app/playlist/_components/PlaylistCover.tsx"],
    ["../_components/SortableTracks", "src/app/playlist/_components/SortableTracks.tsx"],
  ],
  "collaborative playlist tests",
);

// Expose CollectionMenu items directly in SSR so tests can assert owner vs collaborator menu entries.
const playlistActionsStubs = {
  ...commonStubs,
  "./CollectionActions": moduleUrl(`
    import {createElement} from ${JSON.stringify(reactUrl)};
    export const PlayCollectionButton = () => null;
    export const ShuffleCollectionButton = () => null;
    export const useQueueAllItem = () => ({ label: "Zur Warteschlange hinzufügen", onClick() {} });
    export function CollectionMenu({items}) {
      return createElement("div", {"data-testid": "playlist-overflow"}, items.map((item, i) => createElement("span", {key: i}, item.label)));
    }
  `),
};
commonStubs["../_components/PlaylistActions"] = await compileSource(
  "src/app/playlist/_components/PlaylistActions.tsx",
  playlistActionsStubs,
  "PlaylistActions",
);

const { default: PlaylistPage } = await import(
  await compileSource("src/app/playlist/[id]/page.tsx", commonStubs, "PlaylistPage"),
);
const { default: PlaylistJoinPage } = await import(
  await compileSource("src/app/playlist/join/[token]/page.tsx", commonStubs, "PlaylistJoinPage"),
);
const { default: AddToPlaylistModal } = await import(
  await compileSource("src/components/AddToPlaylistModal.tsx", commonStubs, "AddToPlaylistModal"),
);

const success = (data) => ({
  data,
  error: null,
  isPending: false,
  isLoading: false,
  isError: false,
  isFetching: false,
  isSuccess: true,
  refetch: async () => {},
});
const failure = (error) => ({
  data: undefined,
  error,
  isPending: false,
  isLoading: false,
  isError: true,
  isFetching: false,
  isSuccess: false,
  refetch: async () => {},
});

const baseTrack = (id, title, addedBy = null) => ({
  id,
  playlist_entry_id: Number(id) * 10,
  title,
  artist: "Nachtfalter",
  album: "Neonregen",
  cover: "",
  duration_sec: 200,
  added_by: addedBy,
});

beforeEach(() => {
  fixture.playlist = success(null);
  fixture.invitePreview = success(null);
  fixture.acceptState = { isPending: false, isError: false, error: null, mutate() {} };
  fixture.addModal = {
    track: null,
    session: 1,
    me: { id: 1, display_name: "Demo" },
    playlists: success([]),
  };
});

test("playlist permission helpers reflect owner, active collaborator, paused collaborator, and viewer rules", () => {
  assert.equal(canEditPlaylistTracks({ is_owner: true, is_collaborative: false }), true);
  assert.equal(canEditPlaylistTracks({ is_owner: false, is_collaborator: true, is_collaborative: true }), true);
  assert.equal(canEditPlaylistTracks({ is_owner: false, is_collaborator: true, is_collaborative: false }), false);
  assert.equal(canEditPlaylistTracks({ is_owner: false, is_collaborator: false, is_collaborative: true }), false);
  assert.equal(canEditPlaylistTracks({ is_owner: false, is_collaborator: true, is_collaborative: true, can_edit_tracks: false }), false);

  assert.equal(isOwnedLibraryPlaylist({ is_owner: true, is_collaborator: false }), true);
  assert.equal(isOwnedLibraryPlaylist({ is_owner: false, is_collaborator: true }), false);
  assert.equal(isOwnedLibraryPlaylist({}), true);

  assert.equal(playlistHeroEyebrow({ is_owner: true, is_public: true, is_collaborative: true }), "Öffentliche gemeinsame Playlist");
  assert.equal(playlistHeroEyebrow({ is_owner: true, is_public: false, is_collaborative: true }), "Gemeinsame Playlist");
  assert.equal(playlistHeroEyebrow({ is_owner: false, is_collaborator: true, is_collaborative: false }), "Geteilte Playlist · Schreibgeschützt");
  assert.equal(playlistHeroEyebrow({ is_owner: false, is_public: true, is_collaborative: false }), "Playlist");

  assert.equal(sidebarPlaylistMeta({ id: 1, name: "A", track_count: 5, is_owner: true, is_collaborative: true }), "Gemeinsam · 5 Titel");
  assert.equal(sidebarPlaylistMeta({ id: 2, name: "B", track_count: 8, is_owner: false, is_collaborator: true, owner_name: "Jule" }), "von Jule · 8 Titel");
  assert.equal(libraryPlaylistSubtitle({ id: 2, name: "B", track_count: 8, is_owner: false, is_collaborator: true, is_collaborative: true, owner_name: "Jule" }), "Gemeinsam · von Jule · 8 Titel");
  assert.equal(playlistMemberCount({ collaborator_count: 2 }), 3);
});

test("PlaylistPage renders owner collaborative view with avatars, attribution, edit/delete actions, and editable tracks", () => {
  fixture.playlist = success({
    id: 1,
    name: "Sommer-Mix",
    description: "Alle werfen rein",
    is_public: false,
    is_owner: true,
    owner_id: 1,
    owner_name: "Demo",
    is_collaborative: true,
    is_collaborator: false,
    can_edit_tracks: true,
    collaborators: [{ user_id: 2, display_name: "Jule", avatar_url: null, role: "editor" }],
    collaborator_count: 1,
    tracks: [
      baseTrack("101", "Laternen", { id: 2, display_name: "Jule", avatar_url: null }),
    ],
  });

  const html = renderToStaticMarkup(createElement(PlaylistPage, { params: { id: "1-sommer-mix" } }));
  assert.match(html, /Gemeinsame Playlist/);
  assert.match(html, /Gemeinsam \(2\)/);
  assert.match(html, /2 Personen/);
  assert.match(html, /data-note-label="Hinzugefügt von"/);
  assert.match(html, /href="\/users\/2"[^>]*>Jule<\/a>/);
  assert.match(html, /data-removable="true" data-draggable="true"/);
  assert.match(html, /Details bearbeiten/);
  assert.match(html, /Playlist löschen/);
  assert.doesNotMatch(html, /Playlist verlassen/);
});

test("PlaylistPage renders active collaborator view with editable tracks and leave action (no delete/edit)", () => {
  fixture.playlist = success({
    id: 4,
    name: "WG-Küche",
    is_public: false,
    is_owner: false,
    owner_id: 2,
    owner_name: "Jule",
    is_collaborative: true,
    is_collaborator: true,
    can_edit_tracks: true,
    collaborators: [{ user_id: 1, display_name: "Demo", avatar_url: null, role: "editor" }],
    collaborator_count: 1,
    tracks: [
      baseTrack("201", "Mondbasis", { id: 1, display_name: "Demo", avatar_url: null }),
    ],
  });

  const html = renderToStaticMarkup(createElement(PlaylistPage, { params: { id: "4-wg-kueche" } }));
  assert.match(html, /Gemeinsame Playlist/);
  assert.match(html, /von <a href="\/users\/2">Jule<\/a>/);
  assert.match(html, /data-removable="true" data-draggable="true"/);
  assert.match(html, /Playlist verlassen/);
  assert.doesNotMatch(html, /Playlist löschen/);
  assert.doesNotMatch(html, /Details bearbeiten/);
  assert.doesNotMatch(html, /Cover ändern/);
});

test("PlaylistPage renders paused collaborator view as read-only with pause notice and leave action", () => {
  fixture.playlist = success({
    id: 4,
    name: "WG-Küche",
    is_public: false,
    is_owner: false,
    owner_id: 2,
    owner_name: "Jule",
    is_collaborative: false,
    is_collaborator: true,
    can_edit_tracks: false,
    collaborators: [{ user_id: 1, display_name: "Demo", avatar_url: null, role: "editor" }],
    collaborator_count: 1,
    tracks: [
      baseTrack("201", "Mondbasis", { id: 2, display_name: "Jule", avatar_url: null }),
    ],
  });

  const html = renderToStaticMarkup(createElement(PlaylistPage, { params: { id: "4-wg-kueche" } }));
  assert.match(html, /Geteilte Playlist · Schreibgeschützt/);
  assert.match(html, /Die gemeinsame Bearbeitung wurde pausiert/);
  assert.match(html, /data-removable="false" data-draggable="false"/);
  assert.match(html, /Playlist verlassen/);
  assert.doesNotMatch(html, /Playlist löschen/);
});

test("PlaylistJoinPage rejects malformed tokens, shows specific 404/410 errors, and renders preview/member states", () => {
  const invalidHtml = renderToStaticMarkup(
    createElement(PlaylistJoinPage, { params: { token: "short" } }),
  );
  assert.match(invalidHtml, /Ungültiger Einladungslink/);

  fixture.invitePreview = failure(new FakeApiError(404, "Not found"));
  const notFoundHtml = renderToStaticMarkup(
    createElement(PlaylistJoinPage, { params: { token: "valid-token-12345678" } }),
  );
  assert.match(notFoundHtml, /Einladungslink nicht gefunden/);

  fixture.invitePreview = failure(new FakeApiError(410, "Revoked"));
  const goneHtml = renderToStaticMarkup(
    createElement(PlaylistJoinPage, { params: { token: "valid-token-12345678" } }),
  );
  assert.match(goneHtml, /Einladungslink nicht mehr aktiv/);

  fixture.invitePreview = success({
    playlist_id: 51,
    name: "Kellerparty 2026",
    description: "Bringt Songs mit",
    cover_url: null,
    track_count: 12,
    collaborator_count: 2,
    owner: { id: 3, display_name: "Tariq", avatar_url: null },
    is_owner: false,
    already_collaborator: false,
  });
  const previewHtml = renderToStaticMarkup(
    createElement(PlaylistJoinPage, { params: { token: "valid-token-12345678" } }),
  );
  assert.match(previewHtml, /Kellerparty 2026/);
  assert.match(previewHtml, /Tariq/);
  assert.match(previewHtml, /12 Titel/);
  assert.match(previewHtml, /3 Personen/);
  assert.match(previewHtml, /Playlist beitreten/);

  fixture.invitePreview = success({
    ...fixture.invitePreview.data,
    already_collaborator: true,
  });
  const memberHtml = renderToStaticMarkup(
    createElement(PlaylistJoinPage, { params: { token: "valid-token-12345678" } }),
  );
  assert.match(memberHtml, /Du bist bereits Mitwirkende:r dieser Playlist/);
  assert.match(memberHtml, /href="\/playlist\/51-kellerparty-2026"[^>]*>Playlist öffnen/);
});

test("PlaylistPage omits Hinzugefügt von on solo playlists with owner-attributed tracks, but keeps it if an external contributor added a track", () => {
  fixture.playlist = success({
    id: 2,
    name: "Sonntagmorgen",
    is_public: false,
    is_owner: true,
    owner_id: 1,
    owner_name: "Demo",
    is_collaborative: false,
    is_collaborator: false,
    can_edit_tracks: true,
    collaborators: [],
    collaborator_count: 0,
    tracks: [
      baseTrack("101", "Laternen", { id: 1, display_name: "Demo", avatar_url: null }),
    ],
  });
  const soloHtml = renderToStaticMarkup(createElement(PlaylistPage, { params: { id: "2-sonntagmorgen" } }));
  assert.match(soloHtml, /Private Playlist/);
  assert.match(soloHtml, /data-note-label=""/);
  assert.doesNotMatch(soloHtml, /Hinzugefügt von/);

  fixture.playlist = success({
    ...fixture.playlist.data,
    tracks: [
      baseTrack("101", "Laternen", { id: 2, display_name: "Jule", avatar_url: null }),
    ],
  });
  const formerCollabTrackHtml = renderToStaticMarkup(createElement(PlaylistPage, { params: { id: "2-sonntagmorgen" } }));
  assert.match(formerCollabTrackHtml, /data-note-label="Hinzugefügt von"/);
  assert.match(formerCollabTrackHtml, /href="\/users\/2"[^>]*>Jule<\/a>/);
});

test("AddToPlaylistModal includes active collaborative playlists and excludes read-only or unpermissioned playlists", () => {
  fixture.addModal.track = { id: "900", title: "Laternen", artist: "Nachtfalter" };
  fixture.addModal.playlists = success([
    { id: 1, name: "Eigene Liste", track_count: 3, is_owner: true, is_collaborative: false, can_edit_tracks: true },
    { id: 4, name: "WG-Küche", track_count: 9, is_owner: false, is_collaborator: true, is_collaborative: true, can_edit_tracks: true, owner_name: "Jule" },
    { id: 5, name: "Pausiert", track_count: 6, is_owner: false, is_collaborator: true, is_collaborative: false, can_edit_tracks: false, owner_name: "Tariq" },
    { id: 9, name: "Ohne Rechteflags", track_count: 2 },
  ]);

  const html = renderToStaticMarkup(createElement(AddToPlaylistModal));
  assert.match(html, /Eigene Liste/);
  assert.match(html, /WG-Küche/);
  assert.match(html, /Gemeinsam · von Jule/);
  assert.doesNotMatch(html, /Pausiert/);
  assert.doesNotMatch(html, /Ohne Rechteflags/);
});
