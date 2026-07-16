import { describe, expect, it, vi } from 'vitest';
import {
  countUnseenReleaseRadarTracks,
  decodeReleaseRadarSeenTrackIds,
  markReleaseRadarTracksSeen,
  mergeReleaseRadarSeenTrackIds,
  readReleaseRadarSeenTrackIds,
  releaseRadarSeenStorageKey,
  releaseRadarTrackIds,
} from './releaseRadar';

describe('Release Radar seen state', () => {
  it('uses an origin-and-account-scoped key', () => {
    const first = releaseRadarSeenStorageKey('https://music.test::user:7');
    expect(first).toBe(
      'lr.release-radar.seen.v1:https%3A%2F%2Fmusic.test%3A%3Auser%3A7',
    );
    expect(releaseRadarSeenStorageKey('https://other.test::user:7')).not.toBe(first);
    expect(releaseRadarSeenStorageKey('https://music.test::user:8')).not.toBe(first);
    expect(() => releaseRadarSeenStorageKey('  ')).toThrow('scope must not be empty');
  });

  it('normalizes radar identity to unique non-empty track IDs', () => {
    expect(releaseRadarTrackIds([{ id: '12' }, { id: '12' }, { id: '13' }])).toEqual([
      '12',
      '13',
    ]);
    expect(() => releaseRadarTrackIds([{ id: '' }])).toThrow('without an ID');
  });

  it('counts only newly added unique IDs and ignores ordering or removals', () => {
    expect(countUnseenReleaseRadarTracks(['2', '1', '1'], ['1', '2'])).toBe(0);
    expect(countUnseenReleaseRadarTracks(['1'], ['1', '2'])).toBe(0);
    expect(countUnseenReleaseRadarTracks(['1', '2', '3', '3'], ['1', '2'])).toBe(1);
    expect(countUnseenReleaseRadarTracks(['1', '2'], [])).toBe(2);
  });

  it('decodes a strict cumulative ID set', () => {
    expect(decodeReleaseRadarSeenTrackIds(null)).toEqual([]);
    expect(decodeReleaseRadarSeenTrackIds('["1","1"," 2 "]')).toEqual(['1', '2']);
    expect(() => decodeReleaseRadarSeenTrackIds('{')).toThrow('valid JSON');
    expect(() => decodeReleaseRadarSeenTrackIds('["1",""]')).toThrow(
      'list of non-empty track IDs',
    );
    expect(() => decodeReleaseRadarSeenTrackIds('{"id":"1"}')).toThrow(
      'list of non-empty track IDs',
    );
  });

  it('acknowledges visible tracks cumulatively and skips redundant writes', async () => {
    let raw: string | null = '["1","2"]';
    const getItem = vi.fn(async () => raw);
    const setItem = vi.fn(async (_key: string, value: string) => { raw = value; });
    const storage = { getItem, setItem };
    const scope = 'https://music.test::user:7';

    await expect(markReleaseRadarTracksSeen(storage, scope, ['2', '3'])).resolves.toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(setItem).toHaveBeenCalledExactlyOnceWith(
      releaseRadarSeenStorageKey(scope),
      '["1","2","3"]',
    );

    await expect(markReleaseRadarTracksSeen(storage, scope, ['1'])).resolves.toEqual([
      '1',
      '2',
      '3',
    ]);
    expect(setItem).toHaveBeenCalledOnce();
    await expect(readReleaseRadarSeenTrackIds(storage, scope)).resolves.toEqual(['1', '2', '3']);
  });

  it('keeps seen IDs that disappear from a later response', () => {
    const seen = mergeReleaseRadarSeenTrackIds(['1', '2'], ['2', '3']);
    expect(seen).toEqual(['1', '2', '3']);
    expect(mergeReleaseRadarSeenTrackIds(seen, ['1'])).toEqual(['1', '2', '3']);
  });

  it('serializes overlapping acknowledgements and makes readers await the complete set', async () => {
    let raw: string | null = '["1"]';
    let releaseFirstWrite: (() => void) | undefined;
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    let writeCount = 0;
    const getItem = vi.fn(async () => raw);
    const setItem = vi.fn(async (_key: string, value: string) => {
      writeCount += 1;
      if (writeCount === 1) await firstWriteGate;
      raw = value;
    });
    const storage = { getItem, setItem };
    const scope = 'https://music.test::user:7';

    const first = markReleaseRadarTracksSeen(storage, scope, ['2']);
    await vi.waitFor(() => expect(setItem).toHaveBeenCalledOnce());
    const second = markReleaseRadarTracksSeen(storage, scope, ['3']);
    const read = readReleaseRadarSeenTrackIds(storage, scope);
    expect(getItem).toHaveBeenCalledOnce();

    releaseFirstWrite?.();
    await expect(first).resolves.toEqual(['1', '2']);
    await expect(second).resolves.toEqual(['1', '2', '3']);
    await expect(read).resolves.toEqual(['1', '2', '3']);
    expect(raw).toBe('["1","2","3"]');
  });
});
