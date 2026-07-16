import { describe, expect, it, vi } from 'vitest';
import { createMusicMutationOptions, mutationKeys } from './mutationOptions';
import type { MusicRepository } from './repositories';

vi.mock('./repositories', () => ({ musicRepository: {} }));

function mutationContext(): never {
  return {} as never;
}

type MusicMutationFactories = ReturnType<typeof createMusicMutationOptions>;
type MusicMutationFactoryName = keyof MusicMutationFactories;

interface MutationOptionUnderTest {
  mutationKey?: readonly unknown[];
  mutationFn?: unknown;
}

interface MutationFactoryCase {
  factory: MusicMutationFactoryName;
  repositoryMethod: keyof MusicRepository;
  option: (mutations: MusicMutationFactories) => unknown;
  variables: unknown;
  expectedKey: readonly unknown[];
  expectedArguments: readonly unknown[];
}

const playlistCreate = { name: 'Road trip', description: null };
const playlistPatch = { name: 'Road trip 2', description: 'Updated' };
const trackInput = { id: '12', title: 'Song' };
const secondTrackInput = { id: '13', title: 'Second' };
const partyPlayback = { is_playing: true, position_sec: 8.25 };

/** Adding a mutation factory without an exact scoped key/payload case fails the meta-test. */
const MUTATION_FACTORY_CASES: readonly MutationFactoryCase[] = [
  {
    factory: 'createPlaylist', repositoryMethod: 'createPlaylist',
    option: (mutations) => mutations.createPlaylist('  account-a  '),
    variables: playlistCreate,
    expectedKey: ['music', 'mutation', 'account-a', 'playlist', 'create'],
    expectedArguments: [playlistCreate],
  },
  {
    factory: 'updatePlaylist', repositoryMethod: 'updatePlaylist',
    option: (mutations) => mutations.updatePlaylist('  account-a  '),
    variables: { id: 4, patch: playlistPatch },
    expectedKey: ['music', 'mutation', 'account-a', 'playlist', 'update'],
    expectedArguments: [4, playlistPatch],
  },
  {
    factory: 'deletePlaylist', repositoryMethod: 'deletePlaylist',
    option: (mutations) => mutations.deletePlaylist('  account-a  '), variables: 4,
    expectedKey: ['music', 'mutation', 'account-a', 'playlist', 'delete'],
    expectedArguments: [4],
  },
  {
    factory: 'addToPlaylist', repositoryMethod: 'addToPlaylist',
    option: (mutations) => mutations.addToPlaylist('  account-a  '),
    variables: { id: 4, track: trackInput },
    expectedKey: ['music', 'mutation', 'account-a', 'playlist', 'add-track'],
    expectedArguments: [4, trackInput],
  },
  {
    factory: 'removeFromPlaylist', repositoryMethod: 'removePlaylistEntry',
    option: (mutations) => mutations.removeFromPlaylist('  account-a  '),
    variables: { id: 4, entryId: 91 },
    expectedKey: ['music', 'mutation', 'account-a', 'playlist', 'remove-track'],
    expectedArguments: [4, 91],
  },
  {
    factory: 'reorderPlaylist', repositoryMethod: 'reorderPlaylistEntries',
    option: (mutations) => mutations.reorderPlaylist('  account-a  '),
    variables: { id: 4, entryIds: [92, 91] },
    expectedKey: ['music', 'mutation', 'account-a', 'playlist', 'reorder'],
    expectedArguments: [4, [92, 91]],
  },
  {
    factory: 'addTracksBulk', repositoryMethod: 'addTracksBulk',
    option: (mutations) => mutations.addTracksBulk('  account-a  '),
    variables: { id: 4, tracks: [trackInput, secondTrackInput] },
    expectedKey: ['music', 'mutation', 'account-a', 'playlist', 'add-tracks-bulk'],
    expectedArguments: [4, [trackInput, secondTrackInput]],
  },
  {
    factory: 'setPlaylistVisibility', repositoryMethod: 'setPlaylistVisibility',
    option: (mutations) => mutations.setPlaylistVisibility('  account-a  '),
    variables: { id: 4, isPublic: true },
    expectedKey: ['music', 'mutation', 'account-a', 'playlist', 'visibility'],
    expectedArguments: [4, true],
  },
  {
    factory: 'preloadTrack', repositoryMethod: 'preloadTrack',
    option: (mutations) => mutations.preloadTrack('  account-a  '), variables: '12',
    expectedKey: ['music', 'mutation', 'account-a', 'storage', 'preload-track'],
    expectedArguments: ['12'],
  },
  {
    factory: 'createParty', repositoryMethod: 'createParty',
    option: (mutations) => mutations.createParty('  account-a  '),
    variables: { name: 'Night session' },
    expectedKey: ['music', 'mutation', 'account-a', 'party', 'create'],
    expectedArguments: [{ name: 'Night session' }],
  },
  {
    factory: 'joinParty', repositoryMethod: 'joinParty',
    option: (mutations) => mutations.joinParty('  account-a  '), variables: 'ABC123',
    expectedKey: ['music', 'mutation', 'account-a', 'party', 'join'],
    expectedArguments: ['ABC123'],
  },
  {
    factory: 'partyAddTrack', repositoryMethod: 'partyAddTrack',
    option: (mutations) => mutations.partyAddTrack('  account-a  '),
    variables: { code: 'ABC123', track: trackInput },
    expectedKey: ['music', 'mutation', 'account-a', 'party', 'add-track'],
    expectedArguments: ['ABC123', trackInput],
  },
  {
    factory: 'partyRemoveTrack', repositoryMethod: 'partyRemoveTrack',
    option: (mutations) => mutations.partyRemoveTrack('  account-a  '),
    variables: { code: 'ABC123', itemId: 91 },
    expectedKey: ['music', 'mutation', 'account-a', 'party', 'remove-track'],
    expectedArguments: ['ABC123', 91],
  },
  {
    factory: 'partyReorder', repositoryMethod: 'partyReorder',
    option: (mutations) => mutations.partyReorder('  account-a  '),
    variables: { code: 'ABC123', ids: [3, 1, 2] },
    expectedKey: ['music', 'mutation', 'account-a', 'party', 'reorder'],
    expectedArguments: ['ABC123', [3, 1, 2]],
  },
  {
    factory: 'partySetCurrent', repositoryMethod: 'partySetCurrent',
    option: (mutations) => mutations.partySetCurrent('  account-a  '),
    variables: { code: 'ABC123', index: 2 },
    expectedKey: ['music', 'mutation', 'account-a', 'party', 'set-current'],
    expectedArguments: ['ABC123', 2],
  },
  {
    factory: 'partySetPlayback', repositoryMethod: 'partySetPlayback',
    option: (mutations) => mutations.partySetPlayback('  account-a  '),
    variables: { code: 'ABC123', update: partyPlayback },
    expectedKey: ['music', 'mutation', 'account-a', 'party', 'set-playback'],
    expectedArguments: ['ABC123', partyPlayback],
  },
  {
    factory: 'leaveParty', repositoryMethod: 'leaveParty',
    option: (mutations) => mutations.leaveParty('  account-a  '), variables: 'ABC123',
    expectedKey: ['music', 'mutation', 'account-a', 'party', 'leave'],
    expectedArguments: ['ABC123'],
  },
  {
    factory: 'approveAdminUser', repositoryMethod: 'approveAdminUser',
    option: (mutations) => mutations.approveAdminUser('  account-a  '), variables: 9,
    expectedKey: ['music', 'mutation', 'account-a', 'admin', 'approve-user'],
    expectedArguments: [9],
  },
  {
    factory: 'deleteAdminUser', repositoryMethod: 'deleteAdminUser',
    option: (mutations) => mutations.deleteAdminUser('  account-a  '), variables: 9,
    expectedKey: ['music', 'mutation', 'account-a', 'admin', 'delete-user'],
    expectedArguments: [9],
  },
  {
    factory: 'cleanupAdminStorage', repositoryMethod: 'cleanupAdminStorage',
    option: (mutations) => mutations.cleanupAdminStorage('  account-a  '), variables: undefined,
    expectedKey: ['music', 'mutation', 'account-a', 'admin', 'cleanup-storage'],
    expectedArguments: [],
  },
  {
    factory: 'createAdminInvite', repositoryMethod: 'createAdminInvite',
    option: (mutations) => mutations.createAdminInvite('  account-a  '), variables: undefined,
    expectedKey: ['music', 'mutation', 'account-a', 'admin', 'create-invite'],
    expectedArguments: [],
  },
];

describe('music mutation options', () => {
  it('accounts for every current mutation factory in the executable contract table', () => {
    const factories = createMusicMutationOptions({} as MusicRepository);
    expect(Object.keys(factories).sort()).toEqual(
      MUTATION_FACTORY_CASES.map(({ factory }) => factory).sort(),
    );
    expect(new Set(MUTATION_FACTORY_CASES.map(({ factory }) => factory)).size)
      .toBe(MUTATION_FACTORY_CASES.length);
  });

  it.each(MUTATION_FACTORY_CASES)(
    '$factory uses its normalized scope and forwards the exact payload',
    async ({ repositoryMethod, option: buildOption, variables, expectedKey, expectedArguments }) => {
      const repositoryCall = vi.fn(async () => undefined);
      const repository = { [repositoryMethod]: repositoryCall } as unknown as MusicRepository;
      const factories = createMusicMutationOptions(repository);
      const option = buildOption(factories) as MutationOptionUnderTest;

      expect(option.mutationKey).toEqual(expectedKey);
      expect(typeof option.mutationFn).toBe('function');
      const mutationFn = option.mutationFn as (
        variables: unknown,
        context: never,
      ) => Promise<unknown>;
      await mutationFn(variables, mutationContext());

      expect(repositoryCall).toHaveBeenCalledOnce();
      expect(repositoryCall).toHaveBeenCalledWith(...expectedArguments);
    },
  );

  it('forwards exact playlist variables through a viewer-scoped mutation', async () => {
    const addTracksBulk = vi.fn(async () => ({ added: 1 }));
    const mutations = createMusicMutationOptions({ addTracksBulk } as unknown as MusicRepository);
    const option = mutations.addTracksBulk('user-7');
    const variables = { id: 4, tracks: [{ id: '12', title: 'Song' }] };

    expect(option.mutationKey).toEqual([
      'music',
      'mutation',
      'user-7',
      'playlist',
      'add-tracks-bulk',
    ]);
    await option.mutationFn!(variables, mutationContext());
    expect(addTracksBulk).toHaveBeenCalledWith(4, variables.tracks);
  });

  it('forwards party playback and admin actions without reshaping bodies', async () => {
    const partySetPlayback = vi.fn(async () => undefined);
    const approveAdminUser = vi.fn(async () => undefined);
    const mutations = createMusicMutationOptions({
      partySetPlayback,
      approveAdminUser,
    } as unknown as MusicRepository);
    const update = { is_playing: true, position_sec: 8.25 };

    await mutations
      .partySetPlayback(7)
      .mutationFn!({ code: 'ABC123', update }, mutationContext());
    await mutations.approveAdminUser(7).mutationFn!(9, mutationContext());
    expect(partySetPlayback).toHaveBeenCalledWith('ABC123', update);
    expect(approveAdminUser).toHaveBeenCalledWith(9);
  });

  it('rejects empty mutation scopes', () => {
    expect(() => mutationKeys.playlist('', 'create')).toThrow('mutation scope must not be empty');
  });
});
