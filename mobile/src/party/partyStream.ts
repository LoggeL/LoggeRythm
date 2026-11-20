import { authenticatedHeadersFor } from '../api/client';
import { decodePartyState } from '../api/decoders';
import type { PartyState } from '../api/types';
import { getApiBase } from '../config';
import { strings } from '../localization';

/** Characters of stream text after which the connection is renewed to bound memory. */
export const PARTY_STREAM_RENEW_AFTER_CHARS = 1_000_000;

export interface SseParser {
  /** Feed newly received text; complete events are delivered synchronously. */
  push(chunk: string): void;
}

/**
 * Minimal Server-Sent Events parser for the party stream: `data:` lines are
 * joined per event, a blank line ends the event, comment lines (heartbeats)
 * and other fields are ignored.
 */
export function createSseParser(onData: (data: string) => void): SseParser {
  let buffer = '';
  let data: string[] = [];
  return {
    push(chunk: string) {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline === -1) return;
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line === '') {
          if (data.length > 0) {
            const payload = data.join('\n');
            data = [];
            onData(payload);
          }
          continue;
        }
        if (line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon === -1 ? line : line.slice(0, colon);
        if (field !== 'data') continue;
        let value = colon === -1 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        data.push(value);
      }
    },
  };
}

/** Decode one stream frame; a malformed frame is a broken contract, not a skip. */
export function decodePartyFrame(data: string): PartyState {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch (error) {
    throw new Error(`Party stream sent invalid JSON: ${(error as Error).message}`);
  }
  return decodePartyState(json);
}

export interface PartyStreamHandlers {
  onState(state: PartyState): void;
  /** The connection ended or failed; the caller decides when to reconnect. */
  onClosed(error: Error): void;
  /** The stream reached its size budget and should be reopened right away. */
  onRenew(): void;
}

export interface PartyStreamFactoryDependencies {
  createRequest(): XMLHttpRequest;
  apiBase(): Promise<string>;
  headersFor(url: string): Promise<Record<string, string>>;
}

const defaultDependencies: PartyStreamFactoryDependencies = {
  createRequest: () => new XMLHttpRequest(),
  apiBase: getApiBase,
  headersFor: (url) => authenticatedHeadersFor(url),
};

/**
 * Open `/api/party/{code}/events`. React Native's fetch cannot stream, so the
 * stream rides on XMLHttpRequest progress events. The session cookie is set
 * explicitly, like every other API call; the native cookie jar stays unused.
 * Returns a function that closes the connection without reporting it.
 */
export async function openPartyStream(
  code: string,
  handlers: PartyStreamHandlers,
  dependencies: PartyStreamFactoryDependencies = defaultDependencies,
): Promise<() => void> {
  const base = await dependencies.apiBase();
  const url = `${base}/api/party/${encodeURIComponent(code)}/events`;
  const headers = await dependencies.headersFor(url);
  const request = dependencies.createRequest();
  let closed = false;
  let consumed = 0;
  const finish = (error: Error) => {
    if (closed) return;
    closed = true;
    request.abort();
    handlers.onClosed(error);
  };
  const parser = createSseParser((data) => {
    if (closed) return;
    let state: PartyState;
    try {
      state = decodePartyFrame(data);
    } catch (error) {
      finish(error as Error);
      return;
    }
    handlers.onState(state);
  });
  const consume = () => {
    if (closed) return;
    if (request.status !== 200) return;
    const text = request.responseText;
    if (text.length <= consumed) return;
    const chunk = text.slice(consumed);
    consumed = text.length;
    parser.push(chunk);
    if (!closed && consumed >= PARTY_STREAM_RENEW_AFTER_CHARS) {
      closed = true;
      request.abort();
      handlers.onRenew();
    }
  };

  request.open('GET', url);
  request.withCredentials = false;
  request.setRequestHeader('Accept', 'text/event-stream');
  request.setRequestHeader('Cache-Control', 'no-cache');
  for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
  request.onprogress = consume;
  request.onload = () => {
    consume();
    if (request.status === 200) finish(new Error(strings.party.streamEnded));
    else finish(new Error(streamFailure(request.status, request.responseText)));
  };
  request.onerror = () => finish(new Error(strings.party.streamNetwork));
  request.ontimeout = () => finish(new Error(strings.party.streamTimeout));
  request.send();
  return () => {
    if (closed) return;
    closed = true;
    request.abort();
  };
}

function streamFailure(status: number, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') detail = parsed.detail;
  } catch {
    // A non-JSON error body is reported by its status alone.
  }
  return strings.party.streamRejected(status, detail);
}
