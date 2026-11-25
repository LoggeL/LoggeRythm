import { describe, expect, it, vi } from 'vitest';
import type { LyricsResponse } from '../api/types';
import {
  offlineLyricsStorageKey,
  readOfflineLyrics,
  saveOfflineLyrics,
} from './lyricsCache';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
}));

describe('offline lyrics cache', () => {
  it('saves and reads lyrics scoped by account and track id', async () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => { map.set(key, value); },
      removeItem: async (key: string) => { map.delete(key); },
    };
    const lyrics: LyricsResponse = {
      lines: [{ t: 10, text: 'Around the world' }],
      synced: true,
      source: 'lrclib',
      ai_generated: false,
    };

    await saveOfflineLyrics('https://a.test::user:1', '3135556', lyrics, storage);
    expect(map.has(offlineLyricsStorageKey('https://a.test::user:1'))).toBe(true);
    await expect(readOfflineLyrics('https://a.test::user:1', '3135556', storage)).resolves.toEqual({
      ...lyrics,
      cached: true,
    });
    await expect(readOfflineLyrics('https://a.test::user:2', '3135556', storage)).resolves.toBeNull();
  });

  it('serializes concurrent saves for the same account scope without dropping tracks', async () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => {
        await Promise.resolve();
        return map.get(key) ?? null;
      },
      setItem: async (key: string, value: string) => {
        await Promise.resolve();
        map.set(key, value);
      },
      removeItem: async (key: string) => { map.delete(key); },
    };
    const lyricsA: LyricsResponse = {
      lines: [{ t: 1, text: 'First track' }],
      synced: true,
      source: 'lrclib',
      ai_generated: false,
    };
    const lyricsB: LyricsResponse = {
      lines: [{ t: 2, text: 'Second track' }],
      synced: true,
      source: 'lrclib',
      ai_generated: false,
    };

    await Promise.all([
      saveOfflineLyrics('https://a.test::user:1', '101', lyricsA, storage),
      saveOfflineLyrics('https://a.test::user:1', '102', lyricsB, storage),
    ]);
    await expect(readOfflineLyrics('https://a.test::user:1', '101', storage)).resolves.toEqual({
      ...lyricsA,
      cached: true,
    });
    await expect(readOfflineLyrics('https://a.test::user:1', '102', storage)).resolves.toEqual({
      ...lyricsB,
      cached: true,
    });
  });
});
