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
  CachedTrackIds,
  DeezerPlaylistDetail,
  DeezerId,
  Genre,
  GenreDetail,
  HomeShelf,
  LyricsResponse,
  PartyState,
  PlaybackSettings,
  Playlist,
  PlaylistEntryId,
  PlaylistCreateRequest,
  PlaylistSearchResult,
  PlaylistSummary,
  PlaylistUpdateRequest,
  PublicProfile,
  ResolveResult,
  StorageCleanupResult,
  Track,
  TrackInput,
  TrackPlayCounts,
  TrackPlayQuery,
  User,
  UserStats,
} from '../api/types';
import type { AlbumCard } from '../domain/catalog';
import { mapAlbumSearchWire } from './mappers/albumSearch';
import type {
  MeUpdateRequest,
  PartyCreateRequest,
  PartyPlaybackUpdate,
  PlaybackSettingsUpdate,
} from '../api/endpoints';
import type { AuthenticatedRequestAuthority } from '../api/client';

export interface SearchRepository {
  searchTracks(query: string, signal?: AbortSignal): Promise<Track[]>;
  searchAlbums(query: string, signal?: AbortSignal): Promise<AlbumCard[]>;
  searchArtists(query: string, signal?: AbortSignal): Promise<ArtistSummary[]>;
  searchPlaylists(query: string, signal?: AbortSignal): Promise<PlaylistSearchResult[]>;
  resolveExternalUrl(url: string, signal?: AbortSignal): Promise<ResolveResult>;
  getDeezerPlaylist(id: DeezerId, signal?: AbortSignal): Promise<DeezerPlaylistDetail>;
}

export interface HomeRepository {
  getHomeMixes(signal?: AbortSignal): Promise<HomeShelf[]>;
  getBecauseYouListened(signal?: AbortSignal): Promise<HomeShelf[]>;
  getHomeChartCollections(signal?: AbortSignal): Promise<HomeShelf[]>;
  getReleaseRadar(signal?: AbortSignal): Promise<Track[]>;
  getMood(tag: string, signal?: AbortSignal): Promise<Track[]>;
}

export interface CatalogRepository {
  getCharts(signal?: AbortSignal): Promise<Track[]>;
  getGenres(signal?: AbortSignal): Promise<Genre[]>;
  getGenre(id: DeezerId, signal?: AbortSignal): Promise<GenreDetail>;
  getNewReleases(signal?: AbortSignal): Promise<AlbumSummary[]>;
  getTrack(id: DeezerId, signal?: AbortSignal): Promise<Track>;
  getAlbum(id: DeezerId, signal?: AbortSignal): Promise<AlbumDetail>;
  getArtist(id: DeezerId, signal?: AbortSignal): Promise<ArtistDetail>;
  getArtistAbout(name: string, signal?: AbortSignal): Promise<ArtistAbout>;
  getLyrics(
    artist: string,
    title: string,
    deezerId?: DeezerId,
    signal?: AbortSignal,
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
}

export interface PlaylistsRepository {
  getPlaylists(signal?: AbortSignal): Promise<PlaylistSummary[]>;
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
}

export interface LibraryRepository {
  getLikes(signal?: AbortSignal): Promise<Track[]>;
  likeTrack(track: Track): Promise<void>;
  unlikeTrack(deezerId: DeezerId): Promise<void>;
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
  updateMe(patch: MeUpdateRequest): Promise<User>;
  deleteMe(): Promise<void>;
  getPlaybackSettings(signal?: AbortSignal): Promise<PlaybackSettings>;
  updatePlaybackSettings(patch: PlaybackSettingsUpdate): Promise<PlaybackSettings>;
}

export interface PartyRepository {
  createParty(request?: PartyCreateRequest): Promise<PartyState>;
  getParty(code: string, signal?: AbortSignal): Promise<PartyState>;
  joinParty(code: string): Promise<PartyState>;
  partyAddTrack(code: string, track: TrackInput): Promise<void>;
  partyRemoveTrack(code: string, itemId: number): Promise<void>;
  partyReorder(code: string, ids: number[]): Promise<void>;
  partySetCurrent(code: string, index: number): Promise<void>;
  partySetPlayback(code: string, update: PartyPlaybackUpdate): Promise<void>;
  leaveParty(code: string): Promise<void>;
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
  getBecauseYouListened: api.getBecauseYouListened,
  getHomeChartCollections: api.getHomeChartCollections,
  getReleaseRadar: api.getReleaseRadar,
  getMood: api.getMood,
  getGenres: api.getGenres,
  getGenre: api.getGenre,
  getNewReleases: api.getNewReleases,
  getTrack: api.getTrack,
  getAlbum: api.getAlbum,
  getArtist: api.getArtist,
  getArtistAbout: api.getArtistAbout,
  getRadio: api.getRadio,
  recordPlay: api.recordPlay,
  resolveExternalUrl: api.resolveExternalUrl,
  getDeezerPlaylist: api.getDeezerPlaylist,
  getLyrics: api.getLyrics,
  getCachedTrackIds: api.getCachedTrackIds,
  preloadTrack: api.preloadTrack,
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
  getLikes: api.getLikes,
  likeTrack: api.likeTrack,
  unlikeTrack: api.unlikeTrack,
  getFollowingArtists: api.getFollowingArtists,
  followingContains: api.followingContains,
  followArtist: api.followArtist,
  unfollowArtist: api.unfollowArtist,
  getPublicProfile: api.getPublicProfile,
  getStats: api.getStats,
  updateMe: api.updateMe,
  deleteMe: api.deleteMe,
  getPlaybackSettings: api.getPlaybackSettings,
  updatePlaybackSettings: api.updatePlaybackSettings,
  createParty: api.createParty,
  getParty: api.getParty,
  joinParty: api.joinParty,
  partyAddTrack: api.partyAddTrack,
  partyRemoveTrack: api.partyRemoveTrack,
  partyReorder: api.partyReorder,
  partySetCurrent: api.partySetCurrent,
  partySetPlayback: api.partySetPlayback,
  leaveParty: api.leaveParty,
  getAdminUsers: api.getAdminUsers,
  approveAdminUser: api.approveAdminUser,
  deleteAdminUser: api.deleteAdminUser,
  getAdminStatus: api.getAdminStatus,
  getAdminStorage: api.getAdminStorage,
  cleanupAdminStorage: api.cleanupAdminStorage,
  getAdminInvites: api.getAdminInvites,
  createAdminInvite: api.createAdminInvite,
};
