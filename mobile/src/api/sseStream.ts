import { authenticatedHeadersFor } from './client';
import { getApiBase } from '../config';
import { createSseParser } from '../party/partyStream';

/** Maximum buffered XHR characters before recycling the SSE connection. */
export const SSE_STREAM_RENEW_AFTER_CHARS = 1_000_000;

/** Typed HTTP rejection error surfaced by authenticated SSE streams. */
export class SseHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SseHttpError';
    this.status = status;
  }
}

export interface SseStreamHandlers<T> {
  onMessage(payload: T): void;
  onClosed(error: Error): void;
  onRenew(): void;
}

export interface SseStreamDependencies {
  createRequest(): XMLHttpRequest;
  apiBase(): Promise<string>;
  headersFor(url: string): Promise<Record<string, string>>;
}

const defaultDependencies: SseStreamDependencies = {
  createRequest: () => new XMLHttpRequest(),
  apiBase: getApiBase,
  headersFor: (url) => authenticatedHeadersFor(url),
};

function describeFailure(status: number, body: string, label: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === 'string') detail = parsed.detail;
  } catch {
    // Non-JSON error bodies are reported by status code alone.
  }
  return detail
    ? `${label} stream rejected with HTTP ${status}: ${detail}`
    : `${label} stream rejected with HTTP ${status}`;
}

/**
 * Open an authenticated Server-Sent Events stream over XMLHttpRequest.
 * Decodes every JSON frame with `decode` and fails loudly on malformed frames
 * or HTTP errors so callers never silently consume corrupt state.
 */
export async function openAuthenticatedSseStream<T>(
  path: string,
  label: string,
  decode: (value: unknown) => T,
  handlers: SseStreamHandlers<T>,
  dependencies: SseStreamDependencies = defaultDependencies,
): Promise<() => void> {
  if (!path.startsWith('/')) {
    throw new Error(`SSE stream path must start with '/': ${path}`);
  }
  const base = await dependencies.apiBase();
  const url = `${base}${path}`;
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

  const parser = createSseParser((rawData) => {
    if (closed) return;
    let decoded: T;
    try {
      const json: unknown = JSON.parse(rawData);
      decoded = decode(json);
    } catch (error) {
      finish(new Error(`${label} stream sent invalid frame: ${(error as Error).message}`));
      return;
    }
    handlers.onMessage(decoded);
  });

  const consume = () => {
    if (closed) return;
    if (request.status !== 200) return;
    const text = request.responseText;
    if (text.length <= consumed) return;
    const chunk = text.slice(consumed);
    consumed = text.length;
    parser.push(chunk);
    if (!closed && consumed >= SSE_STREAM_RENEW_AFTER_CHARS) {
      closed = true;
      request.abort();
      handlers.onRenew();
    }
  };

  request.open('GET', url);
  request.withCredentials = false;
  request.setRequestHeader('Accept', 'text/event-stream');
  request.setRequestHeader('Cache-Control', 'no-cache');
  for (const [name, value] of Object.entries(headers)) {
    request.setRequestHeader(name, value);
  }
  request.onprogress = consume;
  request.onload = () => {
    consume();
    if (request.status === 200) {
      finish(new Error(`${label} stream ended`));
    } else {
      finish(new SseHttpError(request.status, describeFailure(request.status, request.responseText, label)));
    }
  };
  request.onerror = () => finish(new Error(`${label} stream encountered a network error`));
  request.ontimeout = () => finish(new Error(`${label} stream timed out`));
  request.send();

  return () => {
    if (closed) return;
    closed = true;
    request.abort();
  };
}
