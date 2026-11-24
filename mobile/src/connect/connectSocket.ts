import { authenticatedWebSocketConnection } from '../api/client';
import { decodeConnectServerFrame } from '../api/decoders';
import type { ConnectClientFrame, ConnectServerFrame } from '../api/types';

export interface ConnectSocketLike {
  readonly readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ConnectSocketCloseInfo {
  readonly code: number;
  readonly reason: string;
  readonly authFailed: boolean;
  readonly replaced: boolean;
}

export interface ConnectSocketHandlers {
  onOpen(): void;
  onFrame(frame: ConnectServerFrame): void;
  onProtocolError(error: Error): void;
  onClosed(info: ConnectSocketCloseInfo): void;
}

export interface ConnectSocketHandle {
  send(frame: ConnectClientFrame): void;
  close(): void;
}

export interface ConnectSocketDependencies {
  resolveConnection(): Promise<{ url: string; headers: Record<string, string> }>;
  createSocket(url: string, headers: Record<string, string>): ConnectSocketLike;
}

type ReactNativeWebSocketCtor = new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers?: Record<string, string> },
) => ConnectSocketLike;

const defaultDependencies: ConnectSocketDependencies = {
  resolveConnection: () => authenticatedWebSocketConnection('/api/connect/ws'),
  createSocket: (url, headers) => {
    const Ctor = globalThis.WebSocket as unknown as ReactNativeWebSocketCtor | undefined;
    if (typeof Ctor !== 'function') {
      throw new Error('WebSocket API is unavailable in this runtime');
    }
    return new Ctor(url, null, { headers });
  },
};

const WS_OPEN = 1;

export function describeConnectCloseCode(code: number, reason: string): string {
  const detail = reason.trim();
  if (detail.length > 0) return `${detail} (WS ${code})`;
  switch (code) {
    case 4401:
      return 'Authentication required (WS 4401)';
    case 4403:
      return 'Account is not approved for Connect (WS 4403)';
    case 4408:
      return 'Connect session timed out (WS 4408)';
    case 4409:
      return 'This device connected from another session (WS 4409)';
    default:
      return `WebSocket closed (WS ${code})`;
  }
}

/**
 * Open an authenticated Connect WebSocket connection to `/api/connect/ws`.
 * Every incoming message is decoded strictly — invalid JSON or schema drift
 * closes the connection loudly via `onProtocolError` instead of skipping.
 */
export async function openConnectSocket(
  handlers: ConnectSocketHandlers,
  dependencies: ConnectSocketDependencies = defaultDependencies,
): Promise<ConnectSocketHandle> {
  const { url, headers } = await dependencies.resolveConnection();
  const socket = dependencies.createSocket(url, headers);
  let closedByCaller = false;
  let closed = false;

  const handleClose = (code: number, reason: string) => {
    if (closed) return;
    closed = true;
    if (closedByCaller) return;
    handlers.onClosed({
      code,
      reason: describeConnectCloseCode(code, reason),
      authFailed: code === 4401 || code === 4403,
      replaced: code === 4409,
    });
  };

  socket.onopen = () => {
    if (closed) return;
    handlers.onOpen();
  };

  socket.onmessage = (event) => {
    if (closed) return;
    if (typeof event.data !== 'string') {
      const err = new Error('Connect WebSocket received non-text frame');
      closed = true;
      socket.close(1003, 'Non-text frame');
      handlers.onProtocolError(err);
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch (error) {
      const err = new Error(`Connect WebSocket sent invalid JSON: ${(error as Error).message}`);
      closed = true;
      socket.close(1007, 'Invalid JSON');
      handlers.onProtocolError(err);
      return;
    }
    let frame: ConnectServerFrame;
    try {
      frame = decodeConnectServerFrame(json);
    } catch (error) {
      const err = new Error(`Connect WebSocket contract violation: ${(error as Error).message}`);
      closed = true;
      socket.close(1007, 'Invalid frame');
      handlers.onProtocolError(err);
      return;
    }
    handlers.onFrame(frame);
  };

  socket.onerror = (event) => {
    if (closed || closedByCaller) return;
    const message =
      typeof event === 'object' && event !== null && 'message' in event && typeof (event as { message: unknown }).message === 'string'
        ? (event as { message: string }).message
        : 'WebSocket transport error';
    handlers.onProtocolError(new Error(message));
  };

  socket.onclose = (event) => {
    handleClose(typeof event?.code === 'number' ? event.code : 1006, event?.reason ?? '');
  };

  return {
    send(frame: ConnectClientFrame) {
      if (closed || socket.readyState !== WS_OPEN) {
        throw new Error(`Cannot send Connect frame "${frame.type}": WebSocket is not open`);
      }
      socket.send(JSON.stringify(frame));
    },
    close() {
      if (closed) return;
      closedByCaller = true;
      closed = true;
      socket.close(1000, 'Client closed');
    },
  };
}
