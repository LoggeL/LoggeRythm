import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test, { beforeEach } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compileInto, compileSource, moduleUrl } from "./support/compile.mjs";
import {
  canEditPlaylistTracks,
  canInviteToPlaylist,
  invitationDateLabel,
  invitationUserName,
  inviteCandidateAction,
  inviteSearchQuery,
  isOwnedLibraryPlaylist,
  libraryPlaylistSubtitle,
  playlistHeroEyebrow,
  playlistMemberCount,
  sidebarPlaylistMeta,
} from "../src/lib/playlistPermissions.ts";

const apiResolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/searchDecoders") {
      return nextResolve(new URL("../src/lib/searchDecoders.ts", import.meta.url).href, context);
    }
    if (specifier === "@/lib/releaseRadar") {
      return nextResolve(new URL("../src/lib/releaseRadar.ts", import.meta.url).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { api, ApiError } = await import("../src/lib/api.ts");
apiResolver.deregister();

const idleMutation = () => ({ isPending: false, isError: false, error: null, variables: undefined, mutate() {}, reset() {} });

const fixture = {
  playlist: null,
  searchTerm: "",
  candidates: null,
  outgoing: null,
  incoming: null,
  inviteState: idleMutation(),
  withdrawState: idleMutation(),
  acceptState: idleMutation(),
  declineState: idleMutation(),
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
  export const SavePlaylistIcon = ${emptyIcon};
  export const CheckIcon = ${emptyIcon};
  export const GripIcon = ${emptyIcon};
  export const PlusIcon = ${emptyIcon};
  export const CloseIcon = ${emptyIcon};
  export const UserPlusIcon = ${emptyIcon};
  export const SearchIcon = ${emptyIcon};
  export const RadioIcon = ${emptyIcon};
  export const DedupIcon = ${emptyIcon};
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
    export const useSetPlaylistCollaborative = () => ({ isPending: false, isError: false, error: null, mutate() {} });
    export const useRemovePlaylistCollaborator = () => ({ isPending: false, isError: false, error: null, variables: undefined, mutate() {} });
    export const usePlaylistInviteCandidates = (_id, query, enabled) => {
      globalThis.__collabFixture.candidateRequest = { query, enabled };
      return globalThis.__collabFixture.candidates;
    };
    export const usePlaylistOutgoingInvitations = () => globalThis.__collabFixture.outgoing;
    export const useInviteToPlaylist = () => globalThis.__collabFixture.inviteState;
    export const useWithdrawPlaylistInvitation = () => globalThis.__collabFixture.withdrawState;
    export const useMyPlaylistInvitations = () => globalThis.__collabFixture.incoming;
    export const useAcceptPlaylistInvitation = () => globalThis.__collabFixture.acceptState;
    export const useDeclinePlaylistInvitation = () => globalThis.__collabFixture.declineState;
  `),
  "@/hooks/useDebouncedValue": moduleUrl(
    `export const useDebouncedValue = () => globalThis.__collabFixture.searchTerm;`,
  ),
  "@/store/player": moduleUrl(
    `export const usePlayerStore = (selector) => selector({ playQueue() {}, toggle() {}, toggleShuffle() {}, addToQueue() {}, addManyToQueue() {}, index: -1, queue: [], origins: [], queueContext: null, isPlaying: false, shuffle: false });`,
  ),
  "@/store/saveAsPlaylist": moduleUrl(
    `export const openSaveAsPlaylist = () => {};`,
  ),
  "@tanstack/react-query": moduleUrl(
    `export const useQueryClient = () => ({ getQueryData() { return undefined; } });`,
  ),
  "@/lib/trackIdentity": moduleUrl(
    `export const isSameRecording = (a, b) => String(a?.id) === String(b?.id);`,
  ),
  "@/app/library/_tabs/ListFilter": moduleUrl(
    `export default function ListFilter() { return null; } export function NoFilterMatch() { return null; }`,
  ),
  "@/app/library/_tabs/filter": moduleUrl(
    `export const matchesFilter = () => true;`,
  ),
  "../_components/PlaylistQuickAdd": moduleUrl(
    `export default function PlaylistQuickAdd() { return null; }`,
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
    `export const usePlaylistOffline = () => ({ supported: false, downloaded: false, pending: null, progress: null, sizePreviewBytes: null, toggle() {} });`,
  ),
  "@/lib/radio": moduleUrl(
    `export const startSeededRadio = async () => {};`,
  ),
  "@/hooks/usePlaylistEvents": moduleUrl(
    `export const usePlaylistEvents = () => {};`,
  ),
  "../_components/DeduplicatePlaylistDialog": moduleUrl(
    `export default function DeduplicatePlaylistDialog() { return null; }`,
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
    ["./TabHeader", "src/app/library/_tabs/TabHeader.tsx"],
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
const { default: CollaboratorsDialog } = await import(
  await compileSource("src/app/playlist/_components/CollaboratorsDialog.tsx", commonStubs, "CollaboratorsDialog"),
);
const { default: PlaylistInvitations } = await import(
  await compileSource("src/app/library/_tabs/PlaylistInvitations.tsx", commonStubs, "PlaylistInvitations"),
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

const idle = () => ({
  data: undefined,
  error: null,
  isPending: true,
  isLoading: false,
  isError: false,
  isFetching: false,
  isSuccess: false,
  isPlaceholderData: false,
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
  fixture.searchTerm = "";
  fixture.candidates = idle();
  fixture.candidateRequest = null;
  fixture.outgoing = success([]);
  fixture.incoming = success([]);
  fixture.inviteState = idleMutation();
  fixture.withdrawState = idleMutation();
  fixture.acceptState = idleMutation();
  fixture.declineState = idleMutation();
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

test("invitation helpers gate inviting on ownership plus collaboration and map candidate status to actions", () => {
  assert.equal(canInviteToPlaylist({ is_owner: true, is_collaborative: true }), true);
  assert.equal(canInviteToPlaylist({ is_owner: true, is_collaborative: false }), false);
  assert.equal(canInviteToPlaylist({ is_owner: false, is_collaborative: true }), false);

  assert.equal(inviteSearchQuery("  Ju "), "Ju");
  assert.equal(inviteSearchQuery("j"), "j");
  assert.equal(inviteSearchQuery("   "), null);
  assert.equal(inviteSearchQuery(""), null);

  assert.deepEqual(inviteCandidateAction("available"), { label: "Einladen", canInvite: true });
  assert.deepEqual(inviteCandidateAction("invited"), { label: "Eingeladen", canInvite: false });
  assert.deepEqual(inviteCandidateAction("collaborator"), { label: "Mitwirkend", canInvite: false });
  assert.throws(() => inviteCandidateAction("pending"), /Unbekannter Einladungsstatus vom Server: pending/);

  assert.equal(invitationUserName({ id: 5, display_name: "Mara" }), "Mara");
  assert.equal(invitationUserName({ id: 5, display_name: null }), "Nutzer #5");
  assert.equal(invitationDateLabel("2026-11-20T12:00:00Z"), "Eingeladen am 20. Nov. 2026");
  assert.throws(() => invitationDateLabel("gestern"), /Ungültiger Einladungszeitpunkt vom Server: gestern/);
});

test("invitation API client calls the account-invitation endpoints with the documented methods and bodies", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, method: options.method ?? "GET", body: options.body ?? null });
    if (options.method === "DELETE" || String(url).endsWith("/decline")) return new Response(null, { status: 204 });
    if (String(url).endsWith("/accept")) {
      return Response.json({ playlist_id: 51, playlist_name: "Kellerparty 2026", joined: true, already_member: false, role: "editor" });
    }
    if (options.method === "POST") {
      return Response.json({ invitee: { id: 3, display_name: "Tariq", avatar_url: null }, invited_by: null, created_at: "2026-11-26T10:00:00Z" }, { status: 201 });
    }
    return Response.json([]);
  });

  assert.deepEqual(await api.playlistInviteCandidates("1", "Jü & Co"), []);
  assert.deepEqual(await api.playlistInvitations("1"), []);
  assert.equal((await api.inviteToPlaylist("1", 3)).invitee.display_name, "Tariq");
  assert.equal(await api.withdrawPlaylistInvitation("1", 3), undefined);
  assert.deepEqual(await api.myPlaylistInvitations(), []);
  assert.equal((await api.acceptPlaylistInvitation(7)).playlist_id, 51);
  assert.equal(await api.declinePlaylistInvitation(8), undefined);

  assert.deepEqual(calls, [
    { url: "/api/playlists/1/invite-candidates?q=J%C3%BC%20%26%20Co", method: "GET", body: null },
    { url: "/api/playlists/1/invitations", method: "GET", body: null },
    { url: "/api/playlists/1/invitations", method: "POST", body: JSON.stringify({ user_id: 3 }) },
    { url: "/api/playlists/1/invitations/3", method: "DELETE", body: null },
    { url: "/api/playlists/invitations", method: "GET", body: null },
    { url: "/api/playlists/invitations/7/accept", method: "POST", body: null },
    { url: "/api/playlists/invitations/8/decline", method: "POST", body: null },
  ]);
  for (const removed of ["playlistInvite", "createPlaylistInvite", "revokePlaylistInvite", "previewPlaylistInvite", "acceptPlaylistInvite", "addPlaylistCollaborator"]) {
    assert.equal(removed in api, false, `${removed} must be gone`);
  }
});

test("invitation API errors keep status and the server's German detail", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ detail: "Aktiviere zuerst die Zusammenarbeit für diese Playlist." }, { status: 409 }),
  );
  await assert.rejects(api.inviteToPlaylist("2", 3), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 409);
    assert.match(error.message, /Aktiviere zuerst die Zusammenarbeit/);
    return true;
  });
});

const ownerPlaylist = (overrides = {}) => ({
  id: 1,
  name: "Sommer-Mix",
  is_owner: true,
  owner_id: 1,
  owner_name: "Demo",
  is_collaborative: true,
  is_collaborator: false,
  collaborators: [{ user_id: 2, display_name: "Jule", avatar_url: null, role: "editor" }],
  collaborator_count: 1,
  tracks: [],
  ...overrides,
});

function renderDialog(playlist) {
  return renderToStaticMarkup(
    createElement(CollaboratorsDialog, { id: String(playlist.id), playlist, onClose() {}, onRequestLeave() {} }),
  );
}

test("CollaboratorsDialog lets the owner search accounts, shows per-status buttons, and lists pending invitations to withdraw", () => {
  fixture.searchTerm = "a";
  fixture.candidates = success([
    { user: { id: 3, display_name: "Tariq", avatar_url: null }, status: "available" },
    { user: { id: 5, display_name: "Mara", avatar_url: null }, status: "invited" },
    { user: { id: 7, display_name: "Jana", avatar_url: null }, status: "collaborator" },
  ]);
  fixture.outgoing = success([
    { invitee: { id: 5, display_name: "Mara", avatar_url: null }, invited_by: { id: 1, display_name: "Demo" }, created_at: "2026-11-20T12:00:00Z" },
  ]);

  const html = renderDialog(ownerPlaylist());
  assert.match(html, /data-title="Mitwirkende &amp; Einladungen"/);
  assert.match(html, /Personen einladen/);
  assert.match(html, /type="search"/);
  assert.deepEqual(fixture.candidateRequest, { query: "a", enabled: true });
  assert.match(html, /aria-label="Tariq einladen"[^>]*>Einladen</);
  assert.match(html, /<button type="button" disabled=""[^>]*>Eingeladen<\/button>/);
  assert.match(html, /<button type="button" disabled=""[^>]*>Mitwirkend<\/button>/);
  assert.match(html, /Offene Einladungen/);
  assert.match(html, /Eingeladen am 20\. Nov\. 2026/);
  assert.match(html, /aria-label="Einladung an Mara zurückziehen"[^>]*>Zurückziehen</);
  assert.match(html, /href="\/users\/2"[^>]*>Jule<\/a>/);
  assert.doesNotMatch(html, /E-Mail|Einladungslink|QR-Code/);
});

test("CollaboratorsDialog surfaces search, invite and pending-list failures instead of empty results", () => {
  fixture.searchTerm = "zz";
  fixture.candidates = failure(new Error("API /playlists/1/invite-candidates: HTTP 503"));
  fixture.outgoing = failure(new Error("API /playlists/1/invitations: HTTP 500"));
  fixture.inviteState = {
    ...idleMutation(),
    isError: true,
    error: new Error("API /playlists/1/invitations: Dieses Konto ist bereits eingeladen."),
    variables: { userId: 3, name: "Tariq" },
  };

  const html = renderDialog(ownerPlaylist());
  assert.match(html, /Die Suchergebnisse konnten nicht geladen werden: API \/playlists\/1\/invite-candidates: HTTP 503/);
  assert.match(html, /Die offenen Einladungen konnten nicht geladen werden: API \/playlists\/1\/invitations: HTTP 500/);
  assert.match(html, /Tariq konnte nicht eingeladen werden: API \/playlists\/1\/invitations: Dieses Konto ist bereits eingeladen\./);
  assert.doesNotMatch(html, /Kein Konto mit/);
});

test("CollaboratorsDialog replaces the search with a clear notice while collaboration is off", () => {
  fixture.searchTerm = "a";
  const html = renderDialog(ownerPlaylist({ is_collaborative: false }));
  assert.match(html, /Einladen ist nur möglich, solange die gemeinsame Bearbeitung aktiv ist/);
  assert.doesNotMatch(html, /type="search"/);
  assert.doesNotMatch(html, /Offene Einladungen/);
  assert.equal(fixture.candidateRequest, null);
});

test("CollaboratorsDialog shows collaborators only the member list, without invite controls", () => {
  fixture.searchTerm = "a";
  const html = renderDialog(
    ownerPlaylist({ is_owner: false, is_collaborator: true, owner_id: 2, owner_name: "Jule", collaborators: [{ user_id: 1, display_name: "Demo", role: "editor" }] }),
  );
  assert.match(html, /data-title="Mitwirkende"/);
  assert.doesNotMatch(html, /Personen einladen|Offene Einladungen|Zurückziehen/);
  assert.equal(fixture.candidateRequest, null);
});

test("PlaylistInvitations lists incoming invitations with cover, owner, inviter, track count and answer buttons", () => {
  fixture.incoming = success([
    {
      id: 2,
      playlist: {
        playlist_id: 51,
        name: "Kellerparty 2026",
        description: null,
        cover_url: "/cover/51.jpg",
        track_count: 14,
        collaborator_count: 1,
        owner: { id: 3, display_name: "Tariq", avatar_url: null },
      },
      invited_by: { id: 3, display_name: "Tariq", avatar_url: null },
      created_at: "2026-11-21T16:00:00Z",
    },
  ]);
  const html = renderToStaticMarkup(createElement(PlaylistInvitations));
  assert.match(html, /<h2 id="playlist-invitations-heading">Einladungen<\/h2>/);
  assert.match(html, /Eine gemeinsame Playlist wartet auf deine Antwort/);
  assert.match(html, /Kellerparty 2026/);
  assert.match(html, /src="\/cover\/51.jpg"/);
  assert.match(html, /von Tariq · 14 Titel/);
  assert.match(html, /Eingeladen von <strong[^>]*>Tariq<\/strong>/);
  assert.match(html, /aria-label="Einladung zu „Kellerparty 2026“ annehmen"[^>]*>Annehmen</);
  assert.match(html, /aria-label="Einladung zu „Kellerparty 2026“ ablehnen"[^>]*>Ablehnen</);
});

test("PlaylistInvitations stays hidden without invitations but reports a failed load", () => {
  fixture.incoming = success([]);
  assert.equal(renderToStaticMarkup(createElement(PlaylistInvitations)), "");
  fixture.incoming = idle();
  assert.equal(renderToStaticMarkup(createElement(PlaylistInvitations)), "");
  fixture.incoming = failure(new Error("API /playlists/invitations: HTTP 502"));
  const html = renderToStaticMarkup(createElement(PlaylistInvitations));
  assert.match(html, /role="alert"/);
  assert.match(html, /Deine Playlist-Einladungen konnten nicht geladen werden: API \/playlists\/invitations: HTTP 502/);
});

test("PlaylistInvitations shows accept and decline failures with the server message", () => {
  fixture.incoming = success([
    {
      id: 2,
      playlist: { playlist_id: 51, name: "Kellerparty 2026", track_count: 14, collaborator_count: 1, owner: { id: 3, display_name: "Tariq" } },
      invited_by: null,
      created_at: "2026-11-21T16:00:00Z",
    },
  ]);
  fixture.acceptState = { ...idleMutation(), isError: true, error: new Error("API /playlists/invitations/2/accept: Einladung nicht gefunden."), variables: 2 };
  fixture.declineState = {
    ...idleMutation(),
    isError: true,
    error: new Error("API /playlists/invitations/2/decline: HTTP 500"),
    variables: { invitationId: 2, playlistName: "Kellerparty 2026" },
  };
  const html = renderToStaticMarkup(createElement(PlaylistInvitations));
  assert.doesNotMatch(html, /Eingeladen von/);
  assert.match(html, /Einladung konnte nicht angenommen werden: API \/playlists\/invitations\/2\/accept: Einladung nicht gefunden\./);
  assert.match(html, /Einladung zu „Kellerparty 2026“ konnte nicht abgelehnt werden: API \/playlists\/invitations\/2\/decline: HTTP 500/);
});
