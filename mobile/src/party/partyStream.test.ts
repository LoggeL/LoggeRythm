import { describe, expect, it, vi } from 'vitest';
import { strings } from '../localization';
import {
  PARTY_STREAM_RENEW_AFTER_CHARS,
  createSseParser,
  decodePartyFrame,
  openPartyStream,
} from './partyStream';

vi.mock('../api/client', () => ({ authenticatedHeadersFor: vi.fn() }));
vi.mock('../config', () => ({ getApiBase: vi.fn() }));

const frame = {
  code: 'ABC123',
  name: '',
  host_name: 'Host',
  is_host: false,
  current_index: -1,
  is_playing: false,
  position_sec: 0,
  playback_updated_at: null,
  server_time: '2026-11-24T00:00:00Z',
  guests_can_control: false,
  playback_changed_by: '',
  playback_revision: 0,
  ended: false,
  members: [],
  tracks: [],
  viewer_key: 'u:2',
  viewer_name: 'Me',
  viewer_is_guest: false,
};

class FakeRequest {
  status = 0;
  responseText = '';
  withCredentials = true;
  headers: Record<string, string> = {};
  opened: [string, string] | null = null;
  aborted = false;
  onprogress: (() => void) | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(method: string, url: string) {
    this.opened = [method, url];
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send() {}
  abort() {
    this.aborted = true;
  }
  receive(text: string) {
    this.status = 200;
    this.responseText += text;
    this.onprogress?.();
  }
}

async function open() {
  const request = new FakeRequest();
  const handlers = { onState: vi.fn(), onClosed: vi.fn(), onRenew: vi.fn() };
  const close = await openPartyStream('ABC123', handlers, {
    createRequest: () => request as unknown as XMLHttpRequest,
    apiBase: async () => 'https://music.test',
    headersFor: async () => ({ Cookie: 'sf_session=abc' }),
  });
  return { request, handlers, close };
}

describe('party SSE parser', () => {
  it('joins data lines, ignores heartbeats and survives chunks split anywhere', () => {
    const events: string[] = [];
    const parser = createSseParser((data) => events.push(data));
    parser.push(': ping\n\nda');
    parser.push('ta: {"a":1}\r\n\r\ndata: one\ndata:two\nid: 7\n');
    expect(events).toEqual(['{"a":1}']);
    parser.push('\n');
    expect(events).toEqual(['{"a":1}', 'one\ntwo']);
  });

  it('decodes frames strictly', () => {
    expect(decodePartyFrame(JSON.stringify(frame)).code).toBe('ABC123');
    expect(() => decodePartyFrame('{oops')).toThrow(/invalid JSON/);
    expect(() => decodePartyFrame(JSON.stringify({ ...frame, tracks: null }))).toThrow(/tracks/);
  });
});

describe('openPartyStream', () => {
  it('streams authenticated frames without the native cookie jar', async () => {
    const { request, handlers } = await open();
    expect(request.opened).toEqual(['GET', 'https://music.test/api/party/ABC123/events']);
    expect(request.withCredentials).toBe(false);
    expect(request.headers).toMatchObject({ Cookie: 'sf_session=abc', Accept: 'text/event-stream' });

    request.receive(`data: ${JSON.stringify(frame)}\n\n: ping\n\n`);
    request.receive(`data: ${JSON.stringify({ ...frame, current_index: -1, name: 'B' })}\n\n`);
    expect(handlers.onState).toHaveBeenCalledTimes(2);
    expect(handlers.onState.mock.calls[1][0].name).toBe('B');
  });

  it('reports a rejected or ended stream with its cause', async () => {
    const rejected = await open();
    rejected.request.status = 403;
    rejected.request.responseText = JSON.stringify({ detail: 'Nur für Mitglieder' });
    rejected.request.onload?.();
    expect(rejected.handlers.onClosed).toHaveBeenCalledWith(
      new Error(strings.party.streamRejected(403, 'Nur für Mitglieder')),
    );

    const ended = await open();
    ended.request.receive('');
    ended.request.onload?.();
    expect(ended.handlers.onClosed).toHaveBeenCalledWith(new Error(strings.party.streamEnded));

    const broken = await open();
    broken.request.receive('data: {broken\n\n');
    expect(broken.handlers.onClosed).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringMatching(/invalid JSON/),
    }));
    expect(broken.request.aborted).toBe(true);
  });

  it('renews the connection once its text budget is used and closes silently on request', async () => {
    const big = await open();
    big.request.receive(`: ${'x'.repeat(PARTY_STREAM_RENEW_AFTER_CHARS)}\n\n`);
    expect(big.handlers.onRenew).toHaveBeenCalledOnce();
    expect(big.request.aborted).toBe(true);

    const closed = await open();
    closed.close();
    closed.request.onerror?.();
    expect(closed.handlers.onClosed).not.toHaveBeenCalled();
  });
});
