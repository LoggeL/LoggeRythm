import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_SHARED_TEXT_STORAGE_KEY,
  SharedTextCoordinator,
  type SharedTextCoordinatorStorage,
} from './sharedTextCoordinator';

function memoryStorage(initial: string | null = null): SharedTextCoordinatorStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (initial !== null) values.set(PENDING_SHARED_TEXT_STORAGE_KEY, initial);
  return {
    values,
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => { values.set(key, value); }),
    removeItem: vi.fn(async (key) => { values.delete(key); }),
  };
}

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `generated-${index}`;
}

describe('SharedTextCoordinator', () => {
  it('stages through logged-out and pending gates, routes once, and delivers only to focused Search ownership', async () => {
    const storage = memoryStorage();
    const deliver = vi.fn();
    const openSearch = vi.fn(() => true);
    const coordinator = new SharedTextCoordinator({ storage, deliver, createId: ids('share-1') });

    await coordinator.hydrate();
    await coordinator.stage('  https://open.spotify.com/track/ABC123  ');
    expect(storage.values.has(PENDING_SHARED_TEXT_STORAGE_KEY)).toBe(true);
    expect(openSearch).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();

    coordinator.attachNavigator('origin::user:7', openSearch);
    await coordinator.whenIdle();
    expect(openSearch).toHaveBeenCalledOnce();
    expect(deliver).not.toHaveBeenCalled();

    await coordinator.hydrate();
    await coordinator.stage('https://open.spotify.com/track/ABC123');
    coordinator.attachNavigator('origin::user:7', openSearch);
    await coordinator.whenIdle();
    expect(openSearch).toHaveBeenCalledOnce();

    const detachWrongOwner = coordinator.attachSearchOwner('origin::user:8');
    await coordinator.whenIdle();
    expect(deliver).not.toHaveBeenCalled();
    detachWrongOwner();

    coordinator.attachSearchOwner('origin::user:7');
    await coordinator.whenIdle();
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(
      'https://open.spotify.com/track/ABC123',
      'origin::user:7',
    );
    expect(storage.values.has(PENDING_SHARED_TEXT_STORAGE_KEY)).toBe(false);
  });

  it('preserves a pending payload across account replacement and rejects stale route ownership', async () => {
    const storage = memoryStorage();
    const deliver = vi.fn();
    const openFirst = vi.fn(() => true);
    const openSecond = vi.fn(() => true);
    const coordinator = new SharedTextCoordinator({ storage, deliver, createId: ids('share-2') });

    await coordinator.stage('https://open.spotify.com/album/ALBUM1');
    const detachFirst = coordinator.attachNavigator('origin::user:1', openFirst);
    await coordinator.whenIdle();
    expect(openFirst).toHaveBeenCalledOnce();

    detachFirst();
    coordinator.attachSearchOwner('origin::user:1');
    coordinator.attachNavigator('origin::user:2', openSecond);
    await coordinator.whenIdle();
    expect(openSecond).toHaveBeenCalledOnce();
    expect(deliver).not.toHaveBeenCalled();
    expect(storage.values.has(PENDING_SHARED_TEXT_STORAGE_KEY)).toBe(true);

    coordinator.attachSearchOwner('origin::user:2');
    await coordinator.whenIdle();
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(
      'https://open.spotify.com/album/ALBUM1',
      'origin::user:2',
    );
  });

  it('hydrates after process recreation and deduplicates native redelivery before one route action', async () => {
    const storage = memoryStorage();
    const first = new SharedTextCoordinator({
      storage,
      deliver: vi.fn(),
      createId: ids('cold-share'),
    });
    await first.stage('Share title\nhttps://open.spotify.com/playlist/PLAYLIST1');

    const deliver = vi.fn();
    const openSearch = vi.fn(() => true);
    const restored = new SharedTextCoordinator({
      storage,
      deliver,
      createId: ids('must-not-replace'),
    });
    await restored.hydrate();
    await restored.stage('Share title\nhttps://open.spotify.com/playlist/PLAYLIST1');
    restored.attachNavigator('origin::user:9', openSearch);
    restored.attachNavigator('origin::user:9', openSearch);
    await restored.whenIdle();
    expect(openSearch).toHaveBeenCalledOnce();
    expect(deliver).not.toHaveBeenCalled();

    restored.attachSearchOwner('origin::user:9');
    await restored.whenIdle();
    expect(deliver).toHaveBeenCalledOnce();
    expect(storage.values.has(PENDING_SHARED_TEXT_STORAGE_KEY)).toBe(false);
  });

  it('publishes without a route action when the intended Search route already owns the scope', async () => {
    const storage = memoryStorage();
    const deliver = vi.fn();
    const openSearch = vi.fn(() => true);
    const coordinator = new SharedTextCoordinator({ storage, deliver, createId: ids('share-3') });
    coordinator.attachNavigator('origin::user:3', openSearch);
    coordinator.attachSearchOwner('origin::user:3');
    await coordinator.whenIdle();

    await coordinator.stage('https://open.spotify.com/track/READY1');
    expect(openSearch).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith(
      'https://open.spotify.com/track/READY1',
      'origin::user:3',
    );
  });
});
