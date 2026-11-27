import * as api from '../api/endpoints';
import type {
  AddedTracksResult,
  AdminInvite,
  AdminStatus,
  AdminStorageInfo,
  AdminUser,
  AlbumDetail,
  AlbumSummary,
  ArtistAbout,
  ArtistDetail,
  ArtistSummary,
  BatchPreloadResponse,
  CachedTrackIds,
  ConnectState,
  ConnectTicket,
  DeezerPlaylistDetail,
  DeezerId,
  Genre,
  GenreDetail,
  HomeShelf,
  LyricsResponse,
  PartyReaction,
  PartyState,
  PartyVoteSkipResult,
  PlaybackSettings,
  Playlist,
  PlaylistBlendResult,
  PlaylistDeduplicateResult,
  PlaylistDuplicatesResponse,
  PlaylistEntryId,
  PlaylistCreateRequest,
  PlaylistIncomingInvitation,
  PlaylistInviteCandidate,
  PlaylistJoinResult,
  PlaylistListScope,
  PlaylistOutgoingInvitation,
  PlaylistSearchResult,
  PlaylistSummary,
  PlaylistSyncManifest,
  PlaylistUpdateRequest,
  PublicProfile,
  RadioSeedRequest,
  ReleaseRadarEntry,
  ImportJobDetail,
  ImportJobStatus,
  SocialActivityResponse,
  StatsInsightsRange,
  StorageCleanupResult,
  Track,
  TrackAudioMeta,
  TrackInput,
  TrackPlayCounts,
  TrackPlayQuery,
  User,
  UserStatsInsights,
  WrappedReport,
} from '../api/types';
import type { AlbumCard } from '../domain/catalog';
import type { UserStats } from '../domain/listeningStats';
import { mapAlbumSearchWire } from './mappers/albumSearch';
import { mapListeningStatsWire } from './mappers/listeningStats';
import type {
  LyricsLookupOptions,
  LyricsVariant,
  MeUpdateRequest,
  PartyCreateRequest,
  PartyPlaybackUpdate,
  PartySavePlaylistRequest,
  PartySettingsUpdateRequest,
  PartyTrackInsertMode,
  PlaybackSettingsUpdate,
  PlaylistSyncManifestOptions,
  StartImportJobOptions,
} from '../api/endpoints';
import type { AuthenticatedRequestAuthority } from '../api/client';

export interface SearchRepository {
  searchTracks(query: string, signal?: AbortSignal): Promise<Track[]>;
  searchAlbums(query: string, signal?: AbortSignal): Promise<AlbumCard[]>;
  searchArtists(query: string, signal?: AbortSignal): Promise<ArtistSummary[]>;
  searchPlaylists(query: string, signal?: AbortSignal): Promise<PlaylistSearchResult[]>;
  startImportJob(url: string, options?: StartImportJobOptions): Promise<ImportJobStatus>;
  getImportJobs(signal?: AbortSignal): Promise<ImportJobStatus[]>;
  getImportJob(id: string, signal?: AbortSignal): Promise<ImportJobDetail>;
  deleteImportJob(id: string): Promise<void>;
  getDeezerPlaylist(id: DeezerId, signal?: AbortSignal): Promise<DeezerPlaylistDetail>;
}

export interface HomeRepository {
  getHomeMixes(signal?: AbortSignal): Promise<HomeShelf[]>;
  getPersonalMixes?(signal?: AbortSignal): Promise<HomeShelf[]>;
  getBecauseYouListened(signal?: AbortSignal): Promise<HomeShelf[]>;
  getHomeChartCollections(signal?: AbortSignal): Promise<HomeShelf[]>;
  getReleaseRadar(signal?: AbortSignal): Promise<ReleaseRadarEntry[]>;
  getMood(tag: string, signal?: AbortSignal): Promise<Track[]>;
}

export interface CatalogRepository {
  getCharts(signal?: AbortSignal): Promise<Track[]>;
  getGenres(signal?: AbortSignal): Promise<Genre[]>;
  getGenre(id: DeezerId, signal?: AbortSignal): Promise<GenreDetail>;
  getNewReleases(signal?: AbortSignal): Promise<AlbumSummary[]>;
  getTrack(id: DeezerId, signal?: AbortSignal): Promise<Track>;
  getTrackAudioMeta?(id: DeezerId, signal?: AbortSignal): Promise<TrackAudioMeta>;
  getAlbum(id: DeezerId, signal?: AbortSignal): Promise<AlbumDetail>;
  getArtist(id: DeezerId, signal?: AbortSignal): Promise<ArtistDetail>;
  getArtistAbout(name: string, signal?: AbortSignal): Promise<ArtistAbout>;
  getLyrics(
    artist: string,
    title: string,
    deezerId?: DeezerId,
    signal?: AbortSignal,
    variant?: LyricsVariant,
    options?: LyricsLookupOptions,
  ): Promise<LyricsResponse>;
  getTrackPlayCounts(
    tracks: TrackPlayQuery[],
    signal?: AbortSignal,
  ): Promise<TrackPlayCounts>;
}

export interface PreloadTrackOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface StorageRepository {
  getCachedTrackIds(signal?: AbortSignal): Promise<CachedTrackIds>;
  preloadTrack(id: DeezerId, options?: PreloadTrackOptions): Promise<void>;
  preloadTracksBatch?(trackIds: DeezerId[], signal?: AbortSignal): Promise<BatchPreloadResponse>;
}

export interface PlaylistsRepository {
  getPlaylists(signal?: AbortSignal, scope?: PlaylistListScope): Promise<PlaylistSummary[]>;
  getPublicPlaylists(signal?: AbortSignal): Promise<PlaylistSummary[]>;
  getPlaylist(id: number, signal?: AbortSignal): Promise<Playlist>;
  createPlaylist(request: PlaylistCreateRequest): Promise<PlaylistSummary>;
  updatePlaylist(id: number, patch: PlaylistUpdateRequest): Promise<PlaylistSummary>;
  deletePlaylist(id: number): Promise<void>;
  addToPlaylist(id: number, track: TrackInput): Promise<void>;
  removeFromPlaylist(id: number, deezerId: DeezerId): Promise<void>;
  reorderPlaylistTracks(id: number, deezerIds: DeezerId[]): Promise<void>;
  removePlaylistEntry(id: number, entryId: PlaylistEntryId): Promise<void>;
  reorderPlaylistEntries(id: number, entryIds: PlaylistEntryId[]): Promise<void>;
  addTracksBulk(id: number, tracks: TrackInput[]): Promise<AddedTracksResult>;
  setPlaylistVisibility(id: number, isPublic: boolean): Promise<PlaylistSummary>;
  setPlaylistCollaborative(id: number, isCollaborative: boolean): Promise<PlaylistSummary>;
  searchPlaylistInviteCandidates(
    id: number,
    q: string,
    signal?: AbortSignal,
  ): Promise<PlaylistInviteCandidate[]>;
  getPlaylistOutgoingInvitations(
    id: number,
    signal?: AbortSignal,
  ): Promise<PlaylistOutgoingInvitation[]>;
  invitePlaylistCollaborator(id: number, userId: number): Promise<PlaylistOutgoingInvitation>;
  withdrawPlaylistInvitation(id: number, userId: number): Promise<void>;
  getMyPlaylistInvitations(signal?: AbortSignal): Promise<PlaylistIncomingInvitation[]>;
  acceptPlaylistInvitation(invitationId: number): Promise<PlaylistJoinResult>;
  declinePlaylistInvitation(invitationId: number): Promise<void>;
  removePlaylistCollaborator(id: number, userId: number): Promise<void>;
  leavePlaylist(id: number): Promise<void>;
  getPlaylistSyncManifest?(
    id: number,
    options?: PlaylistSyncManifestOptions,
    signal?: AbortSignal,
  ): Promise<PlaylistSyncManifest>;
  getPlaylistDuplicates?(id: number, signal?: AbortSignal): Promise<PlaylistDuplicatesResponse>;
  deduplicatePlaylist?(id: number): Promise<PlaylistDeduplicateResult>;
  createPlaylistBlend?(otherUserId: number): Promise<PlaylistBlendResult>;
}

export interface LibraryRepository {
  getLikes(signal?: AbortSignal): Promise<Track[]>;
  likeTrack(
    track: Track,
    timeoutMs?: number,
    authenticatedRequestAuthority?: AuthenticatedRequestAuthority,
  ): Promise<void>;
  unlikeTrack(
    deezerId: DeezerId,
    timeoutMs?: number,
    authenticatedRequestAuthority?: AuthenticatedRequestAuthority,
  ): Promise<void>;
}

export interface FollowsRepository {
  getFollowingArtists(signal?: AbortSignal): Promise<ArtistSummary[]>;
  followingContains(ids: DeezerId[], signal?: AbortSignal): Promise<Record<string, boolean>>;
  followArtist(artist: ArtistSummary): Promise<void>;
  unfollowArtist(artistId: DeezerId): Promise<void>;
}

export interface ProfileRepository {
  getPublicProfile(userId: number, signal?: AbortSignal): Promise<PublicProfile>;
  getStats(signal?: AbortSignal): Promise<UserStats>;
  getStatsInsights?(range?: StatsInsightsRange, signal?: AbortSignal): Promise<UserStatsInsights>;
  getStatsWrapped?(range?: StatsInsightsRange, signal?: AbortSignal): Promise<WrappedReport>;
  getSocialActivity?(signal?: AbortSignal): Promise<SocialActivityResponse>;
  updateMe(patch: MeUpdateRequest): Promise<User>;
  deleteMe(): Promise<void>;
  getPlaybackSettings(signal?: AbortSignal): Promise<PlaybackSettings>;
  updatePlaybackSettings(patch: PlaybackSettingsUpdate): Promise<PlaybackSettings>;
}

export interface PartyRepository {
  createParty(request?: PartyCreateRequest): Promise<PartyState>;
  getActiveParty(signal?: AbortSignal): Promise<PartyState | null>;
  getParty(code: string, signal?: AbortSignal): Promise<PartyState>;
  joinParty(code: string): Promise<PartyState>;
  partyAddTrack(code: string, track: TrackInput, insert?: PartyTrackInsertMode): Promise<void>;
  partyRemoveTrack(code: string, itemId: number): Promise<void>;
  partyReorder(code: string, ids: number[]): Promise<void>;
  partySetCurrent(code: string, index: number): Promise<void>;
  partySetPlayback(code: string, update: PartyPlaybackUpdate): Promise<void>;
  partyUpdateSettings(code: string, patch: PartySettingsUpdateRequest): Promise<PartyState>;
  endParty(code: string): Promise<void>;
  partyKickMember(code: string, memberKey: string): Promise<void>;
  getPartyCachedTrackIds(code: string, signal?: AbortSignal): Promise<CachedTrackIds>;
  leaveParty(code: string): Promise<void>;
  savePartyAsPlaylist?(code: string, request?: PartySavePlaylistRequest): Promise<PlaylistSummary>;
  transferPartyHost?(code: string, memberKey: string): Promise<PartyState>;
  fillPartyAutoDj?(code: string, count?: number): Promise<PartyState>;
  reactInParty?(code: string, emoji: string): Promise<PartyReaction>;
  voteSkipPartyTrack?(code: string): Promise<PartyVoteSkipResult>;
}

export interface ConnectRepository {
  createConnectTicket(): Promise<ConnectTicket>;
  getConnectState(signal?: AbortSignal): Promise<ConnectState>;
}

export interface AdminRepository {
  getAdminUsers(signal?: AbortSignal): Promise<AdminUser[]>;
  approveAdminUser(userId: number): Promise<void>;
  deleteAdminUser(userId: number): Promise<void>;
  getAdminStatus(signal?: AbortSignal): Promise<AdminStatus>;
  getAdminStorage(signal?: AbortSignal): Promise<AdminStorageInfo>;
  cleanupAdminStorage(): Promise<StorageCleanupResult>;
  getAdminInvites(signal?: AbortSignal): Promise<AdminInvite[]>;
  createAdminInvite(): Promise<AdminInvite>;
}

export interface PlayerRepository {
  getRadio(
    seedId: DeezerId,
    signal?: AbortSignal,
    timeoutMs?: number,
    authenticatedRequestAuthority?: AuthenticatedRequestAuthority,
  ): Promise<Track[]>;
  getSeededRadio?(request: RadioSeedRequest, signal?: AbortSignal): Promise<Track[]>;
  recordPlay(
    track: Track,
    timeoutMs?: number,
    eventId?: string,
    authenticatedRequestAuthority?: AuthenticatedRequestAuthority,
  ): Promise<void>;
}

/** Complete compatibility adapter composed from feature-sized capabilities. */
export interface MusicRepository
  extends SearchRepository,
    HomeRepository,
    CatalogRepository,
    StorageRepository,
    PlaylistsRepository,
    LibraryRepository,
    FollowsRepository,
    ProfileRepository,
    PartyRepository,
    ConnectRepository,
    AdminRepository,
    PlayerRepository {}

export const musicRepository: MusicRepository = {
  searchTracks: api.searchTracks,
  searchAlbums: async (query, signal) =>
    (await api.searchAlbums(query, signal)).map((wire, index) =>
      mapAlbumSearchWire(wire, `searchAlbums[${index}]`),
    ),
  searchArtists: api.searchArtists,
  searchPlaylists: api.searchPlaylists,
  getCharts: api.getCharts,
  getHomeMixes: api.getHomeMixes,
  getPersonalMixes: api.getPersonalMixes,
  getBecauseYouListened: api.getBecauseYouListened,
  getHomeChartCollections: api.getHomeChartCollections,
  getReleaseRadar: api.getReleaseRadar,
  getMood: api.getMood,
  getGenres: api.getGenres,
  getGenre: api.getGenre,
  getNewReleases: api.getNewReleases,
  getTrack: api.getTrack,
  getTrackAudioMeta: api.getTrackAudioMeta,
  getAlbum: api.getAlbum,
  getArtist: api.getArtist,
  getArtistAbout: api.getArtistAbout,
  getRadio: api.getRadio,
  getSeededRadio: api.getSeededRadio,
  recordPlay: api.recordPlay,
  startImportJob: api.startImportJob,
  getImportJobs: api.getImportJobs,
  getImportJob: api.getImportJob,
  deleteImportJob: api.deleteImportJob,
  getDeezerPlaylist: api.getDeezerPlaylist,
  getLyrics: api.getLyrics,
  getCachedTrackIds: api.getCachedTrackIds,
  preloadTrack: api.preloadTrack,
  preloadTracksBatch: api.preloadTracksBatch,
  getTrackPlayCounts: api.getTrackPlayCounts,
  getPlaylists: api.getPlaylists,
  getPublicPlaylists: api.getPublicPlaylists,
  getPlaylist: api.getPlaylist,
  createPlaylist: api.createPlaylist,
  updatePlaylist: api.updatePlaylist,
  deletePlaylist: api.deletePlaylist,
  addToPlaylist: api.addToPlaylist,
  removeFromPlaylist: api.removeFromPlaylist,
  reorderPlaylistTracks: api.reorderPlaylistTracks,
  removePlaylistEntry: api.removePlaylistEntry,
  reorderPlaylistEntries: api.reorderPlaylistEntries,
  addTracksBulk: api.addTracksBulk,
  setPlaylistVisibility: api.setPlaylistVisibility,
  setPlaylistCollaborative: api.setPlaylistCollaborative,
  searchPlaylistInviteCandidates: api.searchPlaylistInviteCandidates,
  getPlaylistOutgoingInvitations: api.getPlaylistOutgoingInvitations,
  invitePlaylistCollaborator: api.invitePlaylistCollaborator,
  withdrawPlaylistInvitation: api.withdrawPlaylistInvitation,
  getMyPlaylistInvitations: api.getMyPlaylistInvitations,
  acceptPlaylistInvitation: api.acceptPlaylistInvitation,
  declinePlaylistInvitation: api.declinePlaylistInvitation,
  removePlaylistCollaborator: api.removePlaylistCollaborator,
  leavePlaylist: api.leavePlaylist,
  getPlaylistSyncManifest: api.getPlaylistSyncManifest,
  getPlaylistDuplicates: api.getPlaylistDuplicates,
  deduplicatePlaylist: api.deduplicatePlaylist,
  createPlaylistBlend: api.createPlaylistBlend,
  getLikes: api.getLikes,
  likeTrack: api.likeTrack,
  unlikeTrack: api.unlikeTrack,
  getFollowingArtists: api.getFollowingArtists,
  followingContains: api.followingContains,
  followArtist: api.followArtist,
  unfollowArtist: api.unfollowArtist,
  getPublicProfile: api.getPublicProfile,
  getStats: async (signal) => mapListeningStatsWire(await api.getStats(signal)),
  getStatsInsights: api.getStatsInsights,
  getStatsWrapped: api.getStatsWrapped,
  getSocialActivity: api.getSocialActivity,
  updateMe: api.updateMe,
  deleteMe: api.deleteMe,
  getPlaybackSettings: api.getPlaybackSettings,
  updatePlaybackSettings: api.updatePlaybackSettings,
  createParty: api.createParty,
  getActiveParty: api.getActiveParty,
  getParty: api.getParty,
  joinParty: api.joinParty,
  partyAddTrack: api.partyAddTrack,
  partyRemoveTrack: api.partyRemoveTrack,
  partyReorder: api.partyReorder,
  partySetCurrent: api.partySetCurrent,
  partySetPlayback: api.partySetPlayback,
  partyUpdateSettings: api.partyUpdateSettings,
  endParty: api.endParty,
  partyKickMember: api.partyKickMember,
  getPartyCachedTrackIds: api.getPartyCachedTrackIds,
  leaveParty: api.leaveParty,
  savePartyAsPlaylist: api.savePartyAsPlaylist,
  transferPartyHost: api.transferPartyHost,
  fillPartyAutoDj: api.fillPartyAutoDj,
  reactInParty: api.reactInParty,
  voteSkipPartyTrack: api.voteSkipPartyTrack,
  createConnectTicket: api.createConnectTicket,
  getConnectState: api.getConnectState,
  getAdminUsers: api.getAdminUsers,
  approveAdminUser: api.approveAdminUser,
  deleteAdminUser: api.deleteAdminUser,
  getAdminStatus: api.getAdminStatus,
  getAdminStorage: api.getAdminStorage,
  cleanupAdminStorage: api.cleanupAdminStorage,
  getAdminInvites: api.getAdminInvites,
  createAdminInvite: api.createAdminInvite,
};
