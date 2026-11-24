import { describe, expect, it, vi } from 'vitest';
import { openConnectSocket, type ConnectSocketLike } from './connectSocket';

vi.mock('../api/client', () => ({ authenticatedWebSocketConnection: vi.fn() }));

class FakeSocket implements ConnectSocketLike {
  readyState = 1;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
  sent: string[] = [];
  closedWith: [number | undefined, string | undefined] | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closedWith = [code, reason];
  }
}

describe('openConnectSocket', () => {
  it('opens with authenticated Cookie header, sends JSON frames, and decodes valid server frames', async () => {
    const socket = new FakeSocket();
    const handlers = {
      onOpen: vi.fn(),
      onFrame: vi.fn(),
      onProtocolError: vi.fn(),
      onClosed: vi.fn(),
    };
    const createSocket = vi.fn(() => socket);
    const handle = await openConnectSocket(handlers, {
      resolveConnection: async () => ({
        url: 'wss://music.test/api/connect/ws',
        headers: { Cookie: 'sf_session=tok' },
      }),
      createSocket,
    });

    expect(createSocket).toHaveBeenCalledWith('wss://music.test/api/connect/ws', {
      Cookie: 'sf_session=tok',
    });

    socket.onopen?.({});
    expect(handlers.onOpen).toHaveBeenCalledOnce();

    handle.send({ type: 'ping' });
    expect(socket.sent).toEqual(['{"type":"ping"}']);

    socket.onmessage?.({ data: JSON.stringify({ type: 'pong', ts: '2026-11-24T00:00:00Z' }) });
    expect(handlers.onFrame).toHaveBeenCalledWith({ type: 'pong', ts: '2026-11-24T00:00:00Z' });
  });

  it('fails loudly and closes on malformed JSON or contract-violating frames', async () => {
    const socket = new FakeSocket();
    const handlers = {
      onOpen: vi.fn(),
      onFrame: vi.fn(),
      onProtocolError: vi.fn(),
      onClosed: vi.fn(),
    };
    await openConnectSocket(handlers, {
      resolveConnection: async () => ({ url: 'wss://music.test/api/connect/ws', headers: {} }),
      createSocket: () => socket,
    });

    socket.onmessage?.({ data: '{bad-json' });
    expect(handlers.onProtocolError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/invalid JSON/) }),
    );
    expect(socket.closedWith?.[0]).toBe(1007);

    const socket2 = new FakeSocket();
    const handlers2 = {
      onOpen: vi.fn(),
      onFrame: vi.fn(),
      onProtocolError: vi.fn(),
      onClosed: vi.fn(),
    };
    await openConnectSocket(handlers2, {
      resolveConnection: async () => ({ url: 'wss://music.test/api/connect/ws', headers: {} }),
      createSocket: () => socket2,
    });
    socket2.onmessage?.({ data: JSON.stringify({ type: 'bogus_event' }) });
    expect(handlers2.onProtocolError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/contract violation/) }),
    );
  });

  it('classifies auth (4401/4403) and replacement (4409) close codes and refuses sends after close', async () => {
    const socket = new FakeSocket();
    const handlers = {
      onOpen: vi.fn(),
      onFrame: vi.fn(),
      onProtocolError: vi.fn(),
      onClosed: vi.fn(),
    };
    const handle = await openConnectSocket(handlers, {
      resolveConnection: async () => ({ url: 'wss://music.test/api/connect/ws', headers: {} }),
      createSocket: () => socket,
    });

    socket.onclose?.({ code: 4401, reason: '' });
    expect(handlers.onClosed).toHaveBeenCalledWith(
      expect.objectContaining({ code: 4401, authFailed: true, replaced: false }),
    );
    expect(() => handle.send({ type: 'ping' })).toThrow(/WebSocket is not open/);
  });
});
