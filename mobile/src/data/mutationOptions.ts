import { mutationOptions } from '@tanstack/react-query';
import type {
  DeezerId,
  PlaylistEntryId,
  PlaylistCreateRequest,
  PlaylistUpdateRequest,
  TrackInput,
} from '../api/types';
import type { PartyCreateRequest, PartyPlaybackUpdate } from '../api/endpoints';
import { musicRepository, type MusicRepository } from './repositories';
import type { QueryScope } from './queryKeys';

function scopeKey(scope: QueryScope): string {
  const normalized = String(scope).trim();
  if (normalized.length === 0) throw new Error('mutation scope must not be empty');
  return normalized;
}

export const mutationKeys = {
  playlist: (scope: QueryScope, action: string) =>
    ['music', 'mutation', scopeKey(scope), 'playlist', action] as const,
  storage: (scope: QueryScope, action: string) =>
    ['music', 'mutation', scopeKey(scope), 'storage', action] as const,
  party: (scope: QueryScope, action: string) =>
    ['music', 'mutation', scopeKey(scope), 'party', action] as const,
  admin: (scope: QueryScope, action: string) =>
    ['music', 'mutation', scopeKey(scope), 'admin', action] as const,
};

export interface UpdatePlaylistVariables {
  id: number;
  patch: PlaylistUpdateRequest;
}

export interface PlaylistTrackVariables {
  id: number;
  track: TrackInput;
}

export interface RemovePlaylistTrackVariables {
  id: number;
  entryId: PlaylistEntryId;
}

export interface ReorderPlaylistVariables {
  id: number;
  entryIds: PlaylistEntryId[];
}

export interface BulkPlaylistVariables {
  id: number;
  tracks: TrackInput[];
}

export interface PlaylistVisibilityVariables {
  id: number;
  isPublic: boolean;
}

export interface PartyTrackVariables {
  code: string;
  track: TrackInput;
}

export interface PartyItemVariables {
  code: string;
  itemId: number;
}

export interface PartyOrderVariables {
  code: string;
  ids: number[];
}

export interface PartyCurrentVariables {
  code: string;
  index: number;
}

export interface PartyPlaybackVariables {
  code: string;
  update: PartyPlaybackUpdate;
}

export function createMusicMutationOptions(repository: MusicRepository = musicRepository) {
  return {
    createPlaylist(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.playlist(scope, 'create'),
        mutationFn: (request: PlaylistCreateRequest) => repository.createPlaylist(request),
      });
    },
    updatePlaylist(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.playlist(scope, 'update'),
        mutationFn: ({ id, patch }: UpdatePlaylistVariables) => repository.updatePlaylist(id, patch),
      });
    },
    deletePlaylist(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.playlist(scope, 'delete'),
        mutationFn: (id: number) => repository.deletePlaylist(id),
      });
    },
    addToPlaylist(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.playlist(scope, 'add-track'),
        mutationFn: ({ id, track }: PlaylistTrackVariables) => repository.addToPlaylist(id, track),
      });
    },
    removeFromPlaylist(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.playlist(scope, 'remove-track'),
        mutationFn: ({ id, entryId }: RemovePlaylistTrackVariables) =>
          repository.removePlaylistEntry(id, entryId),
      });
    },
    reorderPlaylist(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.playlist(scope, 'reorder'),
        mutationFn: ({ id, entryIds }: ReorderPlaylistVariables) =>
          repository.reorderPlaylistEntries(id, entryIds),
      });
    },
    addTracksBulk(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.playlist(scope, 'add-tracks-bulk'),
        mutationFn: ({ id, tracks }: BulkPlaylistVariables) => repository.addTracksBulk(id, tracks),
      });
    },
    setPlaylistVisibility(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.playlist(scope, 'visibility'),
        mutationFn: ({ id, isPublic }: PlaylistVisibilityVariables) =>
          repository.setPlaylistVisibility(id, isPublic),
      });
    },
    preloadTrack(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.storage(scope, 'preload-track'),
        mutationFn: (id: DeezerId) => repository.preloadTrack(id),
      });
    },
    createParty(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.party(scope, 'create'),
        mutationFn: (request: PartyCreateRequest) => repository.createParty(request),
      });
    },
    joinParty(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.party(scope, 'join'),
        mutationFn: (code: string) => repository.joinParty(code),
      });
    },
    partyAddTrack(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.party(scope, 'add-track'),
        mutationFn: ({ code, track }: PartyTrackVariables) => repository.partyAddTrack(code, track),
      });
    },
    partyRemoveTrack(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.party(scope, 'remove-track'),
        mutationFn: ({ code, itemId }: PartyItemVariables) =>
          repository.partyRemoveTrack(code, itemId),
      });
    },
    partyReorder(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.party(scope, 'reorder'),
        mutationFn: ({ code, ids }: PartyOrderVariables) => repository.partyReorder(code, ids),
      });
    },
    partySetCurrent(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.party(scope, 'set-current'),
        mutationFn: ({ code, index }: PartyCurrentVariables) =>
          repository.partySetCurrent(code, index),
      });
    },
    partySetPlayback(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.party(scope, 'set-playback'),
        mutationFn: ({ code, update }: PartyPlaybackVariables) =>
          repository.partySetPlayback(code, update),
      });
    },
    leaveParty(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.party(scope, 'leave'),
        mutationFn: (code: string) => repository.leaveParty(code),
      });
    },
    approveAdminUser(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.admin(scope, 'approve-user'),
        mutationFn: (userId: number) => repository.approveAdminUser(userId),
      });
    },
    deleteAdminUser(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.admin(scope, 'delete-user'),
        mutationFn: (userId: number) => repository.deleteAdminUser(userId),
      });
    },
    cleanupAdminStorage(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.admin(scope, 'cleanup-storage'),
        mutationFn: () => repository.cleanupAdminStorage(),
      });
    },
    createAdminInvite(scope: QueryScope) {
      return mutationOptions({
        mutationKey: mutationKeys.admin(scope, 'create-invite'),
        mutationFn: () => repository.createAdminInvite(),
      });
    },
  };
}

export const musicMutations = createMusicMutationOptions();
