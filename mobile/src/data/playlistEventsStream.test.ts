import { describe, expect, it, vi } from 'vitest';
import type { PlaylistLiveEvent } from '../api/types';
import { openPlaylistEventsStream } from './playlistEventsStream';

vi.mock('../api/client', () => ({ authenticatedHeadersFor: vi.fn() }));
vi.mock('../config', () => ({ getApiBase: vi.fn() }));

function fakeXhr() {
  const xhr = {
    status: 200,
    responseText: '',
    withCredentials: false,
    headers: {} as Record<string, string>,
    openedUrl: '',
    aborted: false,
    onprogress: null as null | (() => void),
    onload: null as null | (() => void),
    onerror: null as null | (() => void),
    ontimeout: null as null | (() => void),
    open(_method: string, url: string) {
      this.openedUrl = url;
    },
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send: vi.fn(),
    abort() {
      this.aborted = true;
    },
  };
  return xhr;
}

describe('openPlaylistEventsStream', () => {
  it('delivers decoded snapshot, updated, revoked, and deleted playlist frames', async () => {
    const xhr = fakeXhr();
    const events: PlaylistLiveEvent[] = [];
    const onClosed = vi.fn();

    const close = await openPlaylistEventsStream(
      42,
      {
        onMessage: (evt) => events.push(evt),
        onClosed,
        onRenew: vi.fn(),
      },
      {
        createRequest: () => xhr as unknown as XMLHttpRequest,
        apiBase: async () => 'https://music.example',
        headersFor: async () => ({ Cookie: 'session=abc' }),
      },
    );

    expect(xhr.openedUrl).toBe('https://music.example/api/playlists/42/events');
    xhr.responseText =
      'data: {"playlist_id":42,"revision":3,"event":"snapshot"}\n\n'
      + 'data: {"playlist_id":42,"revision":4,"event":"updated"}\n\n'
      + 'data: {"playlist_id":42,"revision":4,"event":"revoked"}\n\n';
    xhr.onprogress?.();

    expect(events).toEqual([
      { playlist_id: 42, revision: 3, event: 'snapshot' },
      { playlist_id: 42, revision: 4, event: 'updated' },
      { playlist_id: 42, revision: 4, event: 'revoked' },
    ]);
    expect(onClosed).not.toHaveBeenCalled();

    close();
    expect(xhr.aborted).toBe(true);
  });

  it('fails loudly on invalid playlist id or malformed SSE frames', async () => {
    await expect(
      openPlaylistEventsStream(0, { onMessage: vi.fn(), onClosed: vi.fn(), onRenew: vi.fn() }),
    ).rejects.toThrow(/Invalid playlist id/);

    const xhr = fakeXhr();
    const onClosed = vi.fn();
    await openPlaylistEventsStream(
      5,
      { onMessage: vi.fn(), onClosed, onRenew: vi.fn() },
      {
        createRequest: () => xhr as unknown as XMLHttpRequest,
        apiBase: async () => 'https://music.example',
        headersFor: async () => ({}),
      },
    );
    xhr.responseText = 'data: {"playlist_id":5,"revision":1,"event":"bogus"}\n\n';
    xhr.onprogress?.();
    expect(onClosed).toHaveBeenCalledOnce();
    expect((onClosed.mock.calls[0][0] as Error).message).toContain('invalid frame');
  });
});
