import { describe, expect, it } from 'vitest';
import {
  decodeBatchPreloadResponse,
  decodeLyricsResponse,
  decodePartyState,
  decodePartyVoteSkipResult,
  decodePlaybackSettings,
  decodePlaylistBlendResult,
  decodePlaylistDeduplicateResult,
  decodePlaylistDuplicates,
  decodePlaylistLiveEvent,
  decodePlaylistSyncManifest,
  decodeSocialActivityResponse,
  decodeTrackAudioMeta,
  decodeUserStatsInsights,
} from './decoders';

describe('Wave 2 API decoders', () => {
  it('decodes TrackAudioMeta strictly and rejects invalid shapes', () => {
    const meta = decodeTrackAudioMeta({
      deezer_id: '42',
      peaks: [0.1, 0.5, 0.9],
      loudness_lufs: -11.2,
      loudness_gain_db: -2.8,
      loudness_peak: 0.95,
      bpm: 126,
      duration_sec: 214,
      intro_end_sec: 10.5,
      outro_start_sec: 201.0,
      analyzed_at: '2026-11-25T00:00:00Z',
    });
    expect(meta.peaks).toEqual([0.1, 0.5, 0.9]);
    expect(meta.bpm).toBe(126);
    expect(() =>
      decodeTrackAudioMeta({ deezer_id: 'bad', peaks: [], analyzed_at: '2026-11-25T00:00:00Z' }),
    ).toThrow(/Deezer ID/);
  });

  it('decodes word-level karaoke lyrics and instrumental flag', () => {
    const karaoke = decodeLyricsResponse({
      lines: [
        {
          t: 1.2,
          text: 'Hello world',
          words: [
            { t: 1.2, end: 1.7, text: 'Hello' },
            { t: 1.7, end: 2.3, text: 'world' },
          ],
        },
      ],
      synced: true,
      instrumental: false,
      source: 'groq-word-v1',
      ai_generated: true,
    });
    expect(karaoke.instrumental).toBe(false);
    expect(karaoke.lines?.[0]?.words).toHaveLength(2);
  });

  it('decodes PlaybackSettings quality and activity sharing fields', () => {
    const settings = decodePlaybackSettings({
      crossfade_enabled: true,
      crossfade_duration_sec: 6,
      preferred_quality: 'lossless',
      share_listening_activity: true,
    });
    expect(settings.preferred_quality).toBe('lossless');
    expect(settings.share_listening_activity).toBe(true);
    expect(() =>
      decodePlaybackSettings({
        crossfade_enabled: true,
        crossfade_duration_sec: 6,
        preferred_quality: 'ultra',
      }),
    ).toThrow(/preferred_quality/);
  });

  it('decodes BatchPreload, SyncManifest, Duplicates, Deduplicate, Blend, and LiveEvent', () => {
    expect(decodeBatchPreloadResponse({ queued: ['1', '2'], already_cached: ['3'] })).toEqual({
      queued: ['1', '2'],
      already_cached: ['3'],
    });

    const manifest = decodePlaylistSyncManifest({
      playlist_id: 10,
      revision: 4,
      track_count: 1,
      stored_count: 1,
      total_known_bytes: 5_000_000,
      tracks: [
        {
          playlist_entry_id: 1,
          deezer_id: '42',
          title: 'Track',
          artist: 'Artist',
          duration_sec: 180,
          is_stored: true,
          size_bytes: 5_000_000,
          audio_format: 'flac',
          loudness_gain_db: -2.0,
          loudness_lufs: -12.0,
          loudness_peak: 0.99,
          has_lyrics: true,
        },
      ],
      lyrics: {
        '42': { lines: [{ t: 0, text: 'Line' }], synced: true, source: 'lrclib', ai_generated: false },
      },
    });
    expect(manifest.lyrics?.['42']?.lines).toHaveLength(1);

    const dups = decodePlaylistDuplicates({
      playlist_id: 10,
      total_duplicates: 1,
      groups: [{ keep_entry_id: 1, duplicate_entry_ids: [2], title: 'A', artist: 'B', isrc: 'X' }],
    });
    expect(dups.total_duplicates).toBe(1);

    const deduped = decodePlaylistDeduplicateResult({
      playlist_id: 10,
      groups_merged: 1,
      removed_count: 1,
      removed_entry_ids: [2],
      revision: 5,
    });
    expect(deduped.removed_count).toBe(1);

    expect(decodePlaylistLiveEvent({ playlist_id: 10, revision: 6, event: 'updated' })).toEqual({
      playlist_id: 10,
      revision: 6,
      event: 'updated',
    });

    const blend = decodePlaylistBlendResult({
      match_percent: 84,
      shared_artists: ['Daft Punk'],
      shared_tracks_count: 12,
      other_user: { id: 2, display_name: 'Sam', avatar_url: null },
      playlist: {
        id: 99,
        name: 'Blend',
        description: null,
        cover_url: null,
        is_public: false,
        is_owner: true,
        owner_id: 1,
        owner_name: 'Alex',
        owner_avatar_url: null,
        is_collaborative: true,
        is_collaborator: false,
        can_edit_tracks: true,
        collaborators: [],
        collaborator_count: 0,
        revision: 1,
        tracks: [],
      },
    });
    expect(blend.match_percent).toBe(84);
  });

  it('decodes Party Jam 2.0 extensions, Insights, and Social Activity strictly', () => {
    const party = decodePartyState({
      code: 'JAM123',
      name: 'Party',
      host_name: 'Alex',
      is_host: true,
      current_index: 0,
      is_playing: true,
      position_sec: 10,
      playback_updated_at: '2026-11-25T00:00:00Z',
      server_time: '2026-11-25T00:00:01Z',
      guests_can_control: true,
      auto_dj: true,
      skip_votes: ['u:2'],
      skip_votes_needed: 2,
      latest_reaction: {
        id: 'rx1',
        emoji: '🔥',
        member_key: 'u:2',
        member_name: 'Sam',
        created_at: '2026-11-25T00:00:01Z',
      },
      playback_changed_by: 'Alex',
      playback_revision: 2,
      ended: false,
      members: [],
      tracks: [],
      viewer_key: 'u:1',
      viewer_name: 'Alex',
      viewer_is_guest: false,
    });
    expect(party.auto_dj).toBe(true);
    expect(party.latest_reaction?.emoji).toBe('🔥');

    const vote = decodePartyVoteSkipResult({
      code: 'JAM123',
      track_item_id: 5,
      votes: ['u:2'],
      votes_needed: 2,
      skipped: false,
      state: party,
    });
    expect(vote.votes_needed).toBe(2);

    const insights = decodeUserStatsInsights({
      range: '30d',
      listening_sec: 3600,
      play_count: 15,
      unique_tracks: 12,
      unique_artists: 5,
      top_tracks: [{ key: '42', label: 'Track', sublabel: 'Artist', cover: '', count: 4 }],
      top_artists: [],
      top_albums: [],
      current_streak_days: 3,
      longest_streak_days: 7,
      hourly_distribution: Array(24).fill(0),
      weekday_distribution: Array(7).fill(0),
      new_artists_count: 2,
      recent_plays: [{ id: '42', title: 'Track', played_at: '2026-11-25T00:00:00Z' }],
    });
    expect(insights.current_streak_days).toBe(3);

    const social = decodeSocialActivityResponse({
      items: [
        {
          user_id: 5,
          display_name: 'Mira',
          avatar_url: null,
          is_playing: true,
          track: null,
          device_name: 'Web',
          device_type: 'web',
          party_code: 'JAM123',
          updated_at: '2026-11-25T00:00:00Z',
        },
      ],
      server_time: '2026-11-25T00:00:01Z',
    });
    expect(social.items[0]?.party_code).toBe('JAM123');
  });
});
