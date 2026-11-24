import { describe, expect, it } from 'vitest';
import {
  decodeAddedTracksResult,
  decodeAdminInvites,
  decodeAdminStatus,
  decodeAdminStorageInfo,
  decodeAdminUsers,
  decodeAlbum,
  decodeAlbumSummaries,
  decodeArtistDetail,
  decodeCachedTrackIds,
  decodeConnectDevice,
  decodeConnectServerFrame,
  decodeConnectState,
  decodeConnectTicket,
  decodeDeezerPlaylistDetail,
  decodeGenreDetail,
  decodeHomeShelves,
  decodeLyricsResponse,
  decodeNullablePartyState,
  decodePartyState,
  decodePlaybackSettings,
  decodePlaylist,
  decodePublicProfile,
  decodeReleaseRadar,
  decodeResolveResult,
  decodeStorageCleanupResult,
  decodeTrack,
  decodeTrackPlayCounts,
  decodeUser,
} from './decoders';

const track = {
  id: '3135556',
  title: 'Example',
  artist: 'Artist',
  artist_id: '42',
  artists: [{ id: '42', name: 'Artist' }],
  album: 'Album',
  album_id: 12,
  cover: '',
  duration_sec: 180,
  preview_url: null,
  rank: 0,
  release_date: '',
};

const album = {
  id: '302127',
  title: 'Album',
  artist: 'Artist',
  artist_id: 42,
  cover: '',
  release_date: '2026-01-01',
  nb_tracks: 1,
  tracks: [track],
};

describe('API response decoders', () => {
  it('accepts the backend Track wire format without changing string ids', () => {
    expect(decodeTrack(track)).toEqual(track);
  });

  it('rejects numeric Track ids before they reach likes and player state', () => {
    expect(() => decodeTrack({ ...track, id: 3135556 })).toThrow(/Track.id must be a string/);
  });

  it.each(['', ' ', '-1', '+1', '1.5', '1e3', '12/../34', '１２'])(
    'rejects non-digit Track id %j',
    (id) => {
      expect(() => decodeTrack({ ...track, id })).toThrow(
        /Track.id must be a non-empty digit-only Deezer ID/,
      );
    },
  );

  it.each<{
    label: string;
    change: Record<string, unknown>;
    message: RegExp;
  }>([
    { label: 'artist_id', change: { artist_id: 'artist-42' }, message: /Track.artist_id/ },
    { label: 'album_id', change: { album_id: '12.5' }, message: /Track.album_id/ },
    {
      label: 'artist reference',
      change: { artists: [{ id: 'abc', name: 'Artist' }] },
      message: /Track.artists\[0\]\.id/,
    },
  ])('rejects an invalid $label', ({ change, message }) => {
    expect(() => decodeTrack({ ...track, ...change })).toThrow(message);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unsafe numeric artist and album ids (%s)',
    (id) => {
      expect(() => decodeTrack({ ...track, artist_id: id })).toThrow(/Track.artist_id/);
      expect(() => decodeTrack({ ...track, album_id: id })).toThrow(/Track.album_id/);
      expect(() => decodeTrack({ ...track, artists: [{ id, name: 'Artist' }] })).toThrow(
        /Track.artists\[0\]\.id/,
      );
    },
  );

  it('accepts optional nullable loudness fields from the current Track wire format', () => {
    expect(
      decodeTrack({
        ...track,
        loudness_gain_db: -3,
        loudness_lufs: null,
        loudness_peak: 0.95,
      }),
    ).toMatchObject({
      loudness_gain_db: -3,
      loudness_lufs: null,
      loudness_peak: 0.95,
    });
  });

  it.each(['null', 'quiet', Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid loudness field %s before it reaches likes',
    (value) => {
      expect(() => decodeTrack({ ...track, loudness_gain_db: value })).toThrow(
        /Track.loudness_gain_db/,
      );
    },
  );

  it('accepts safe numeric and digit-only string artist/album ids without coercion', () => {
    expect(
      decodeTrack({
        ...track,
        artist_id: 42,
        album_id: '302127',
        artists: [{ id: 42, name: 'Artist' }],
      }),
    ).toMatchObject({
      artist_id: 42,
      album_id: '302127',
      artists: [{ id: 42, name: 'Artist' }],
    });
  });

  it('accepts empty optional artist and album references emitted by stored backend rows', () => {
    expect(
      decodeTrack({
        ...track,
        artist_id: '',
        album_id: '',
        artists: [{ id: '', name: 'Legacy Artist' }],
      }),
    ).toMatchObject({
      artist_id: '',
      album_id: '',
      artists: [{ id: '', name: 'Legacy Artist' }],
    });
    expect(decodeAlbum({ ...album, artist_id: '' }).artist_id).toBe('');
  });

  it('enforces digit-only album and album-artist ids', () => {
    expect(decodeAlbum(album)).toMatchObject({ id: '302127', artist_id: 42 });
    expect(() => decodeAlbum({ ...album, id: '' })).toThrow(/Album.id/);
    expect(() => decodeAlbum({ ...album, id: 'album-302127' })).toThrow(/Album.id/);
    expect(() => decodeAlbum({ ...album, artist_id: 'artist-42' })).toThrow(/Album.artist_id/);
  });

  it('accepts nullable user display names', () => {
    expect(
      decodeUser({
        id: 1,
        email: 'person@example.test',
        display_name: null,
        is_admin: false,
        is_approved: true,
        avatar_url: null,
      }).display_name,
    ).toBeNull();
  });

  it('validates the PlaylistDetail shape separately from PlaylistSummary', () => {
    const playlist = decodePlaylist({
      id: 7,
      name: 'Mix',
      description: null,
      cover_url: null,
      is_public: false,
      is_owner: true,
      owner_name: null,
      tracks: [{ ...track, playlist_entry_id: 91 }],
    });
    expect(playlist.tracks[0].id).toBe('3135556');
    expect(playlist.tracks[0].playlist_entry_id).toBe(91);
    expect(() => decodePlaylist({
      id: 7,
      name: 'Legacy server',
      description: null,
      cover_url: null,
      is_public: false,
      is_owner: true,
      owner_name: null,
      tracks: [track],
    })).toThrow(/playlist_entry_id/);
  });

  it('decodes complete browse detail and shelf contracts', () => {
    const albumSummary = {
      id: '302127',
      title: 'Album',
      artist: 'Artist',
      cover: 'cover.jpg',
      release_date: '2026-01-01',
    };
    const artistSummary = { id: '42', name: 'Artist', picture: 'artist.jpg' };

    expect(decodeAlbumSummaries([albumSummary])).toEqual([albumSummary]);
    expect(
      decodeArtistDetail({
        ...artistSummary,
        fans: 10,
        albums_count: 1,
        top: [track],
        albums: [albumSummary],
        related: [artistSummary],
      }),
    ).toMatchObject({ id: '42', fans: 10, albums: [albumSummary] });
    expect(
      decodeGenreDetail({
        id: '116',
        name: 'Rap/Hip Hop',
        picture: 'genre.jpg',
        tracks: [track],
        albums: [albumSummary],
        artists: [artistSummary],
      }),
    ).toMatchObject({ id: '116', tracks: [track] });
    expect(
      decodeHomeShelves([
        { key: 'weekly', title: 'Weekly', subtitle: 'For you', cover: '', tracks: [track] },
      ])[0].tracks[0].id,
    ).toBe(track.id);
  });

  it('rejects omitted response-model defaults instead of inventing client defaults', () => {
    expect(() =>
      decodeHomeShelves([{ key: 'weekly', title: 'Weekly', cover: '', tracks: [] }]),
    ).toThrow(/subtitle/);
    expect(() =>
      decodeAlbumSummaries([{ id: '1', title: 'A', artist: 'B', cover: '' }]),
    ).toThrow(/release_date/);
    expect(() =>
      decodeArtistDetail({
        id: '42',
        name: 'Artist',
        picture: '',
        fans: 1,
        albums_count: 0,
        top: [],
        albums: [],
      }),
    ).toThrow(/related/);
  });

  it('decodes nullable public profile fields and strict playback settings', () => {
    expect(
      decodePublicProfile({
        id: 7,
        display_name: null,
        avatar_url: null,
        playlists: [],
        top_artists: [],
      }),
    ).toMatchObject({ id: 7, display_name: null });
    expect(
      decodePlaybackSettings({ crossfade_enabled: true, crossfade_duration_sec: 4 }),
    ).toEqual({ crossfade_enabled: true, crossfade_duration_sec: 4 });
    expect(() =>
      decodePlaybackSettings({ crossfade_enabled: true, crossfade_duration_sec: 1.5 }),
    ).toThrow(/safe non-negative integer/);
  });

  it('decodes playlist mutations, external resolution, and Deezer import without padding', () => {
    expect(decodeAddedTracksResult({ added: 2 })).toEqual({ added: 2 });
    expect(
      decodeResolveResult({
        type: 'playlist',
        name: 'Imported',
        image: '',
        total: 2,
        source_total: 3,
        matched: 1,
        tracks: [track],
        unmatched: [{ title: 'Missing', artist: 'Unknown' }],
      }),
    ).toMatchObject({ type: 'playlist', matched: 1 });
    const imported = decodeDeezerPlaylistDetail({
      id: '99',
      name: 'Public mix',
      cover: '',
      tracks: [{ ...track, release_date: undefined }],
    });
    expect('release_date' in imported.tracks[0]).toBe(false);
    expect(() =>
      decodeResolveResult({
        type: 'podcast',
        name: '',
        image: '',
        total: 0,
        source_total: 0,
        matched: 0,
        tracks: [],
        unmatched: [],
      }),
    ).toThrow(/ResolveResult.type/);
  });

  it('strictly decodes lyrics, cache ids, and Last.fm play-count maps', () => {
    expect(
      decodeLyricsResponse({
        lines: [{ t: 1.25, text: 'Hello' }],
        synced: true,
        source: 'lrclib',
        ai_generated: false,
        cached: true,
      }),
    ).toMatchObject({ cached: true, lines: [{ t: 1.25, text: 'Hello' }] });
    expect(decodeCachedTrackIds({ ids: ['12', '34'] })).toEqual({ ids: ['12', '34'] });
    expect(decodeTrackPlayCounts({ '12': { plays: 5, listeners: 3 } })).toEqual({
      '12': { plays: 5, listeners: 3 },
    });
    expect(() =>
      decodeLyricsResponse({
        lines: null,
        synced: false,
        source: null,
        ai_generated: false,
        cached: false,
      }),
    ).toThrow(/cached must be true/);
    expect(() => decodeTrackPlayCounts({ bad: { plays: 1, listeners: 1 } })).toThrow(
      /digit-only Deezer ID/,
    );
  });

  it('decodes the complete REST party state including host playback and Jam fields', () => {
    const state = decodePartyState({
      code: 'ABC123',
      name: 'Party',
      host_name: 'Host',
      is_host: true,
      current_index: -1,
      is_playing: false,
      position_sec: 0,
      playback_updated_at: null,
      server_time: '2026-11-24T00:00:00Z',
      guests_can_control: true,
      playback_changed_by: 'u:1',
      playback_revision: 3,
      ended: false,
      members: [{ key: 'u:1', name: 'Host', avatar_url: null, is_guest: false, is_host: true }],
      viewer_key: 'u:1',
      viewer_name: 'Host',
      viewer_is_guest: false,
      tracks: [
        {
          id: 1,
          deezer_id: track.id,
          title: track.title,
          artist: track.artist,
          artist_id: '42',
          artists: track.artists,
          album: track.album,
          album_id: '12',
          cover: '',
          duration_sec: 180,
          added_by: 'Host',
          added_by_member: 'u:1',
          added_by_avatar_url: null,
          is_stored: false,
          load_state: 'failed',
          load_error: 'Deezer: 404',
        },
      ],
    });
    expect(state).toMatchObject({
      code: 'ABC123',
      current_index: -1,
      is_host: true,
      viewer_key: 'u:1',
      guests_can_control: true,
      playback_revision: 3,
      ended: false,
    });
    expect(state.tracks[0]).toMatchObject({
      is_stored: false,
      load_state: 'failed',
      load_error: 'Deezer: 404',
    });
    expect(decodeNullablePartyState(null)).toBeNull();
    expect(decodeNullablePartyState(state)?.code).toBe('ABC123');
    expect(() => decodePartyState({ ...state, position_sec: -1 })).toThrow(/position_sec/);
    expect(() => decodePartyState({
      ...state,
      tracks: [{ ...state.tracks[0], load_state: 'cached' }],
    })).toThrow(/load_state/);
    expect(() => decodePartyState({ ...state, viewer_key: undefined })).toThrow(/viewer_key/);
    expect(() => decodePartyState({ ...state, playback_revision: -1 })).toThrow(/playback_revision/);
  });

  it('strictly decodes Connect devices, state, tickets, and WebSocket server frames', () => {
    const device = {
      device_id: 'dev-1',
      name: 'Pixel 9',
      device_type: 'mobile',
      is_active: true,
      volume: 1,
      muted: false,
      connected_at: '2026-11-24T00:00:00Z',
      last_seen_at: '2026-11-24T00:00:10Z',
      capabilities: { can_play_audio: true, can_control_volume: false },
      party_code: null,
    };
    const playback = {
      queue: [track],
      origins: ['context'],
      queue_context: 'Mix',
      current_index: 0,
      is_playing: true,
      position_sec: 12.5,
      duration_sec: 180,
      shuffle: false,
      repeat: 'off',
      volume: 0.8,
      muted: false,
      updated_at: '2026-11-24T00:00:10Z',
    };
    const state = {
      revision: 4,
      active_device_id: 'dev-1',
      devices: [device],
      playback,
      server_time: '2026-11-24T00:00:10Z',
    };

    expect(decodeConnectDevice(device)).toEqual(device);
    expect(decodeConnectState(state)).toEqual(state);
    expect(decodeConnectTicket({ ticket: 'abc', expires_in_sec: 60 })).toEqual({
      ticket: 'abc',
      expires_in_sec: 60,
    });
    expect(
      decodeConnectServerFrame({
        type: 'welcome',
        self_device_id: 'dev-1',
        heartbeat_interval_sec: 15,
        state,
      }),
    ).toMatchObject({
      type: 'welcome',
      self_device_id: 'dev-1',
      heartbeat_interval_sec: 15,
    });
    expect(decodeConnectServerFrame({ type: 'pong', ts: '2026-11-24T00:00:10Z' })).toEqual({
      type: 'pong',
      ts: '2026-11-24T00:00:10Z',
    });
    expect(
      decodeConnectServerFrame({
        type: 'deactivated',
        new_active_device_id: 'dev-2',
        reason: 'transferred',
      }),
    ).toEqual({
      type: 'deactivated',
      new_active_device_id: 'dev-2',
      reason: 'transferred',
    });
    expect(
      decodeConnectServerFrame({
        type: 'command',
        command_id: 'cmd-1',
        request_id: 'req-1',
        from_device_id: 'dev-2',
        action: 'seek',
        payload: { position_sec: 42 },
      }),
    ).toMatchObject({ type: 'command', command_id: 'cmd-1', action: 'seek' });
    expect(
      decodeConnectServerFrame({
        type: 'command_result',
        command_id: 'cmd-1',
        request_id: 'req-1',
        ok: false,
        error: 'Volume unsupported',
      }),
    ).toEqual({
      type: 'command_result',
      command_id: 'cmd-1',
      request_id: 'req-1',
      ok: false,
      error: 'Volume unsupported',
    });
    expect(
      decodeConnectServerFrame({
        type: 'error',
        code: 'device_unreachable',
        detail: 'Gone',
        request_id: null,
      }),
    ).toEqual({
      type: 'error',
      code: 'device_unreachable',
      detail: 'Gone',
      request_id: null,
    });

    expect(() => decodeConnectDevice({ ...device, device_type: 'fridge' })).toThrow(/device_type/);
    expect(() => decodeConnectState({ ...state, playback: { ...playback, volume: 2 } })).toThrow(/volume/);
    expect(() => decodeConnectServerFrame({ type: 'mystery' })).toThrow(/unknown value/);
  });

  it('decodes explicit admin users, storage, status, invites, and cleanup contracts', () => {
    expect(
      decodeAdminUsers([
        {
          id: 1,
          email: 'admin@example.test',
          display_name: null,
          avatar_url: null,
          is_admin: true,
          is_approved: true,
          created_at: '2026-07-15T10:00:00',
        },
      ])[0].is_admin,
    ).toBe(true);
    expect(
      decodeAdminStorageInfo({
        track_count: 1,
        total_bytes: 10,
        disk_total: 100,
        disk_used: 20,
        disk_free: 80,
        retention_days: 30,
        tracks: [
          {
            deezer_id: '12',
            title: 'Song',
            artist: 'Artist',
            size_bytes: 10,
            last_accessed: null,
          },
        ],
      }).track_count,
    ).toBe(1);
    const status = {
      deezer: { arl_configured: true, arl_ok: true, quality: 'mp3' },
      storage: {
        track_count: 1,
        total_bytes: 10,
        disk_total: 100,
        disk_used: 20,
        disk_free: 80,
        retention_days: 30,
      },
      users: { total: 2, approved: 1, pending: 1, admins: 1 },
      content: {
        playlists: 1,
        likes: 2,
        follows: 3,
        plays: 4,
        stored_lyrics: 5,
        parties: 6,
        invites_total: 7,
        invites_used: 1,
      },
      integrations: { spotify_configured: true, lastfm_configured: false },
      system: { app_env: 'prod', database: 'sqlite', jwt_secure: true, cookie_secure: true },
    };
    expect(decodeAdminStatus(status)).toEqual(status);
    expect(
      decodeAdminInvites([
        { code: 'ABCDEFGH', url: '', used_by_name: null, created_at: '2026-07-15T10:00:00' },
      ]),
    ).toHaveLength(1);
    expect(decodeStorageCleanupResult({ removed: 2, freed_bytes: 100 })).toEqual({
      removed: 2,
      freed_bytes: 100,
    });
    expect(() => decodeStorageCleanupResult({ removed: 0.5, freed_bytes: 1 })).toThrow(/removed/);
  });
});

describe('Release Radar decoder', () => {
  const reason = { kind: 'played', artist_id: '7', artist_name: 'Known Artist', play_count: 4 };
  // The wire object is a flat Track that additionally carries `radar_reason`.
  const radarTrack = {
    ...track,
    release_date: '2026-03-01',
    loudness_gain_db: null,
    loudness_lufs: null,
    loudness_peak: null,
    radar_reason: reason,
  };

  it('splits each wire track into a plain Track and the reason it is in the radar', () => {
    const { radar_reason: _reason, ...plainWireTrack } = radarTrack;

    const entries = decodeReleaseRadar([radarTrack]);

    expect(entries).toEqual([{ track: decodeTrack(plainWireTrack), radar_reason: reason }]);
    // The reason must never become part of the Track that gets played, liked,
    // queued or written to the offline manifest.
    expect(Object.keys(entries[0].track)).toEqual(Object.keys(decodeTrack(plainWireTrack)));
    expect('radar_reason' in entries[0].track).toBe(false);
    expect(decodeReleaseRadar([])).toEqual([]);
  });

  it('keeps a watched source artist that differs from the primary artist of the track', () => {
    const [entry] = decodeReleaseRadar([
      { ...radarTrack, artist: 'Stranger', artist_id: '999', artists: [{ id: '999', name: 'Stranger' }] },
    ]);

    expect(entry.track.artist).toBe('Stranger');
    expect(entry.track.artist_id).toBe('999');
    expect(entry.radar_reason).toEqual(reason);
  });

  it('accepts both reason kinds, a zero play count and an unknown source artist name', () => {
    const followed = { kind: 'followed', artist_id: '8', artist_name: '', play_count: 0 };

    expect(decodeReleaseRadar([{ ...radarTrack, radar_reason: followed }])[0].radar_reason)
      .toEqual(followed);
  });

  it('names an outdated server instead of presenting a radar without reasons', () => {
    const { radar_reason: _reason, ...withoutReason } = radarTrack;

    expect(() => decodeReleaseRadar([radarTrack, withoutReason])).toThrow(
      'ReleaseRadar[1].radar_reason is missing: the server does not say why this track is in the Release Radar (it predates radar reasons)',
    );
  });

  it.each<{ label: string; payload: unknown; message: RegExp }>([
    { label: 'non-list radar', payload: { tracks: [] }, message: /ReleaseRadar must be an array/ },
    { label: 'non-object entry', payload: ['1'], message: /ReleaseRadar\[0\] must be an object/ },
    {
      label: 'null reason',
      payload: [{ ...radarTrack, radar_reason: null }],
      message: /ReleaseRadar\[0\]\.radar_reason must be an object/,
    },
    {
      label: 'unknown kind',
      payload: [{ ...radarTrack, radar_reason: { ...reason, kind: 'liked' } }],
      message: /ReleaseRadar\[0\]\.radar_reason\.kind must be one of: followed, played/,
    },
    {
      label: 'missing source artist id',
      payload: [{ ...radarTrack, radar_reason: { ...reason, artist_id: '' } }],
      message: /ReleaseRadar\[0\]\.radar_reason\.artist_id must be a non-empty digit-only Deezer ID/,
    },
    {
      label: 'numeric source artist id',
      payload: [{ ...radarTrack, radar_reason: { ...reason, artist_id: 7 } }],
      message: /ReleaseRadar\[0\]\.radar_reason\.artist_id must be a string/,
    },
    {
      label: 'missing source artist name',
      payload: [{ ...radarTrack, radar_reason: { ...reason, artist_name: undefined } }],
      message: /ReleaseRadar\[0\]\.radar_reason\.artist_name must be a string/,
    },
    {
      label: 'negative play count',
      payload: [{ ...radarTrack, radar_reason: { ...reason, play_count: -1 } }],
      message: /ReleaseRadar\[0\]\.radar_reason\.play_count must be a safe non-negative integer/,
    },
    {
      label: 'fractional play count',
      payload: [{ ...radarTrack, radar_reason: { ...reason, play_count: 1.5 } }],
      message: /ReleaseRadar\[0\]\.radar_reason\.play_count must be a safe non-negative integer/,
    },
    {
      label: 'invalid track inside a reasoned entry',
      payload: [{ ...radarTrack, id: 42 }],
      message: /ReleaseRadar\[0\]\.id must be a string/,
    },
  ])('rejects $label', ({ payload, message }) => {
    expect(() => decodeReleaseRadar(payload)).toThrow(message);
  });
});
