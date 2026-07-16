import { describe, expect, it, vi } from 'vitest';
import {
  decodeNativeClearAllResult,
  decodeNativeDownloadResult,
  decodeNativeHydration,
  decodeNativeProgress,
} from './native';

vi.mock('react-native', () => ({
  NativeEventEmitter: class {},
  NativeModules: {},
}));

const scope = 'https://music.test::user:7';
const directory = 'file:///data/user/0/top.logge.loggerythm/no_backup/downloads/';

describe('offline native bridge decoders', () => {
  it('accepts an exact account-bound hydration with controlled file URIs', () => {
    expect(decodeNativeHydration({
      scope,
      generation: 3,
      directoryUri: directory,
      manifestJson: null,
      availableDiskBytes: 5_000,
      files: [{
        trackId: '42',
        fileName: '42.mp3',
        uri: `${directory}42.mp3`,
        sizeBytes: 1_024,
      }],
      interruptedTrackIds: ['43'],
      invalidTrackIds: ['44'],
    }, scope)).toEqual(expect.objectContaining({
      scope,
      generation: 3,
      files: [expect.objectContaining({ trackId: '42', sizeBytes: 1_024 })],
    }));
  });

  it('rejects cross-account, escaping, duplicate, and unsafe hydration data', () => {
    const base = {
      scope,
      generation: 0,
      directoryUri: directory,
      manifestJson: null,
      availableDiskBytes: 1,
      interruptedTrackIds: [],
      invalidTrackIds: [],
    };
    expect(() => decodeNativeHydration({ ...base, scope: 'https://music.test::user:8', files: [] }, scope))
      .toThrow('another account');
    expect(() => decodeNativeHydration({
      ...base,
      files: [{ trackId: '42', fileName: '42.mp3', uri: 'file:///tmp/42.mp3', sizeBytes: 1 }],
    }, scope)).toThrow('escaped');
    expect(() => decodeNativeHydration({ ...base, files: [], interruptedTrackIds: ['42', '42'] }, scope))
      .toThrow('duplicates');
  });

  it('binds download outcomes to scope, generation, playlist, and directory', () => {
    const decoded = decodeNativeDownloadResult({
      scope,
      generation: 2,
      playlistId: '9',
      availableDiskBytes: 10,
      successes: [{
        trackId: '42',
        fileName: '42.mp3',
        uri: `${directory}42.mp3`,
        sizeBytes: 100,
        reused: false,
      }],
      failures: [{ trackId: '43', code: 'network', retryable: true }],
    }, scope, 2, '9', directory);

    expect(decoded.successes[0]).toEqual(expect.objectContaining({ trackId: '42', reused: false }));
    expect(decoded.failures).toEqual([{ trackId: '43', code: 'network', retryable: true }]);
    expect(() => decodeNativeDownloadResult({ ...decoded, generation: 1 }, scope, 2, '9', directory))
      .toThrow('stale');
  });

  it('rejects impossible progress while preserving a valid terminal event', () => {
    expect(decodeNativeProgress({
      playlistId: '9',
      done: 2,
      total: 2,
      currentTrackId: null,
      bytesWritten: 1_000,
      currentBytes: 0,
      currentTotalBytes: null,
    })).toEqual(expect.objectContaining({ done: 2, total: 2 }));
    expect(() => decodeNativeProgress({
      playlistId: '9',
      done: 3,
      total: 2,
      currentTrackId: null,
      bytesWritten: 1_000,
      currentBytes: 0,
      currentTotalBytes: null,
    })).toThrow('range');
  });

  it('requires explicit native proof that every scope was cleared', () => {
    expect(decodeNativeClearAllResult({ cleanupGeneration: 4, cleared: true })).toEqual({
      cleanupGeneration: 4,
      cleared: true,
    });
    expect(() => decodeNativeClearAllResult({ cleanupGeneration: 4, cleared: false }))
      .toThrow('incomplete');
    expect(() => decodeNativeClearAllResult({ cleanupGeneration: -1, cleared: true }))
      .toThrow('generation');
  });
});
