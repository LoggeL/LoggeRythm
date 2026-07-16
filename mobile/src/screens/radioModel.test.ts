import { describe, expect, it } from 'vitest';
import type { RecentPlay, Track } from '../api/types';
import { orderedUniqueRadioTracks, personalStationIds, radioContentState } from './radioModel';

const recent = (id: string): RecentPlay => ({
  id, title: id, artist: 'Artist', artist_id: '1', artists: [], album: 'Album', album_id: '2',
  cover: '', duration_sec: 1,
});

const track = (id: string): Track => ({
  ...recent(id), preview_url: null, rank: 0, release_date: '',
});

describe('radio model', () => {
  it('deduplicates personal seeds while preserving recent-first order and limit', () => {
    expect(personalStationIds([recent('3'), recent('2'), recent('3'), recent('1')], 3)).toEqual([
      '3', '2', '1',
    ]);
  });

  it('deduplicates station queues without reordering the first occurrences', () => {
    const first = track('2');
    expect(orderedUniqueRadioTracks([first, track('1'), track('2')])).toEqual([first, track('1')]);
  });

  it('distinguishes no response from a successful empty response', () => {
    expect(radioContentState({
      hasData: false,
      empty: false,
      pending: true,
      fetching: true,
      stale: true,
      fetchStatus: 'fetching',
      error: null,
    })).toEqual({ body: 'loading', notice: null });
    expect(radioContentState({
      hasData: true,
      empty: true,
      pending: false,
      fetching: false,
      stale: false,
      fetchStatus: 'idle',
      error: null,
    })).toEqual({ body: 'empty', notice: null });
  });

  it('preserves content and known-empty data under offline and refresh failures', () => {
    const base = {
      hasData: true,
      empty: false,
      pending: false,
      fetching: false,
      stale: true,
      fetchStatus: 'idle' as const,
      error: null as unknown,
    };

    expect(radioContentState({ ...base, empty: true, error: new Error('refresh') }))
      .toEqual({ body: 'empty', notice: 'cached-refresh-error' });
    expect(radioContentState({ ...base, fetchStatus: 'paused' }))
      .toEqual({ body: 'content', notice: 'cached-offline' });
    expect(radioContentState({ ...base, fetching: true, stale: true }))
      .toEqual({ body: 'content', notice: 'refreshing' });
    expect(radioContentState(base)).toEqual({ body: 'content', notice: 'stale' });
  });
});
