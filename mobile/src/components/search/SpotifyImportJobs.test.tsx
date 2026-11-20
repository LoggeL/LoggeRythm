import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { decodeImportJobDetail, decodeImportJobStatuses } from '../../api/decoders';
import type { ImportJobStatus } from '../../api/types';
import { strings } from '../../localization';
import { byTestId, queryByTestId, textContent } from '../../test/render';
import {
  importJobErrorDetail,
  importJobProgressPercent,
  importJobSummary,
  importJobTitle,
} from './importJobModel';
import { SpotifyImportJobList, SpotifyImportJobRow, SpotifyImportProgress } from './SpotifyImportJobs';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../../api/client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(status: number, body: string, message: string) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

const wireJob = {
  id: 'job-1',
  url: 'https://open.spotify.com/playlist/abc',
  status: 'running',
  type: 'playlist',
  name: 'Road trip',
  image: 'https://img.example/p.jpg',
  total: 40,
  source_total: 40,
  processed: 10,
  matched: 9,
  failed_lookups: 0,
  lookup_error: null,
  error: null,
  created_at: '2026-11-20T14:00:00Z',
  updated_at: '2026-11-20T14:00:05Z',
  finished_at: null,
};

const job = (overrides: Partial<ImportJobStatus> = {}): ImportJobStatus => ({
  ...(wireJob as ImportJobStatus),
  ...overrides,
});

describe('import job decoders', () => {
  it('decodes the job list, including a job Spotify has not answered yet', () => {
    const [running, reading] = decodeImportJobStatuses([
      wireJob,
      { ...wireJob, id: 'job-2', status: 'queued', type: '', name: '', total: 0, processed: 0 },
    ]);
    expect(running).toMatchObject({ id: 'job-1', status: 'running', processed: 10 });
    expect(reading).toMatchObject({ id: 'job-2', status: 'queued', type: '' });
  });

  it('rejects unknown states and a finished job without its result', () => {
    expect(() => decodeImportJobStatuses([{ ...wireJob, status: 'paused' }]))
      .toThrow('ImportJobStatus[][0].status must be one of');
    expect(() => decodeImportJobDetail({ ...wireJob, status: 'done', result: null }))
      .toThrow('ImportJobDetail job-1 is done but carries no result');
    expect(() => decodeImportJobDetail({ ...wireJob, status: 'done' }))
      .toThrow('ResolveResult must be');
  });

  it('decodes a finished job with its matched tracks', () => {
    const detail = decodeImportJobDetail({
      ...wireJob,
      status: 'done',
      processed: 40,
      result: {
        type: 'playlist',
        name: 'Road trip',
        image: '',
        total: 40,
        source_total: 40,
        matched: 0,
        tracks: [],
        unmatched: [],
      },
    });
    expect(detail.result).toMatchObject({ name: 'Road trip', total: 40 });
  });
});

describe('import job model', () => {
  it('summarises every state and falls back to the link as title', () => {
    expect(importJobSummary(job({ status: 'queued' }))).toBe(strings.search.importJobQueued);
    expect(importJobSummary(job({ total: 0 }))).toBe(strings.search.importJobReading);
    expect(importJobSummary(job())).toBe(strings.search.importJobProgress(10, 40, 9));
    expect(importJobSummary(job({ status: 'done', matched: 30 })))
      .toBe(strings.search.importJobDone(30, 40));
    expect(importJobSummary(job({ status: 'failed', error: 'Spotify 404' })))
      .toBe(strings.search.importJobFailed('Spotify 404'));
    expect(importJobSummary(job({ status: 'failed' })))
      .toBe(strings.search.importJobFailed(strings.search.importJobNoServerError));
    expect(importJobTitle(job({ name: '' }))).toBe(wireJob.url);
    expect(importJobProgressPercent(job())).toBe(25);
    expect(importJobProgressPercent(job({ total: 0, processed: 0 }))).toBe(0);
  });

  it('shows the server detail, a transport failure and broken responses distinctly', () => {
    const limit = 'Es laufen bereits 3 Importe. Warte, bis einer fertig ist.';
    expect(importJobErrorDetail(new ApiError(429, JSON.stringify({ detail: limit }), 'POST 429')))
      .toBe(limit);
    expect(importJobErrorDetail(new ApiError(0, '', 'POST https://x failed')))
      .toBe(strings.search.importServerUnreachable);
    expect(importJobErrorDetail(new ApiError(502, '<html>', 'POST 502')))
      .toBe(strings.search.importServerNoDetail);
    expect(importJobErrorDetail(new ApiError(202, '{}', 'invalid response shape: id')))
      .toBe('invalid response shape: id');
    expect(importJobErrorDetail(new Error('boom'))).toBe('boom');
  });
});

describe('SpotifyImportJobRow', () => {
  it('opens a job and cancels a running one with labelled controls', () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const row = SpotifyImportJobRow({ job: job(), selected: false, removing: false, onSelect, onRemove });

    const open = byTestId(row, 'spotify-import-job-job-1-open');
    expect(open.props.accessibilityLabel).toBe(strings.search.importJobOpenLabel('Road trip'));
    (open.props.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledOnce();
    expect(queryByTestId(row, 'spotify-import-job-job-1-remove')).not.toBeNull();
    const remove = byTestId(row, 'spotify-import-job-job-1-remove');
    expect(remove.props.accessibilityLabel).toBe(strings.search.importJobCancel('Road trip'));
    (remove.props.onPress as () => void)();
    expect(onRemove).toHaveBeenCalledOnce();
    expect(textContent(row)).toContain(strings.search.importJobProgress(10, 40, 9));
  });

  it('offers removal and the open hint for a finished job', () => {
    const row = SpotifyImportJobRow({
      job: job({ status: 'done' }),
      selected: true,
      removing: true,
      onSelect: vi.fn(),
      onRemove: vi.fn(),
    });
    expect(byTestId(row, 'spotify-import-job-job-1-remove').props).toMatchObject({
      accessibilityLabel: strings.search.importJobRemove('Road trip'),
      accessibilityState: { busy: true, disabled: true },
    });
    expect(textContent(row)).toContain(strings.search.importJobOpen);
  });
});

describe('SpotifyImportJobList', () => {
  const base = {
    retryBusy: false,
    onRetry: vi.fn(),
    selectedId: null,
    removingId: null,
    onSelect: vi.fn(),
    onRemove: vi.fn(),
  };

  it('shows loading, nothing for no imports, and a retryable error', () => {
    expect(queryByTestId(SpotifyImportJobList({ ...base, jobs: undefined, loadError: null }),
      'spotify-import-jobs-loading')).not.toBeNull();
    expect(SpotifyImportJobList({ ...base, jobs: [], loadError: null })).toBeNull();
    const failed = SpotifyImportJobList({ ...base, jobs: undefined, loadError: 'Server down' });
    expect(textContent(failed)).toContain(strings.search.importJobsLoadFailed('Server down'));
    expect(byTestId(failed, 'spotify-import-jobs-error-action').props.onPress).toBe(base.onRetry);
  });

  it('lists imports under its heading', () => {
    const list = SpotifyImportJobList({
      ...base,
      jobs: [job(), job({ id: 'job-2', status: 'done' })],
      loadError: null,
    });
    expect(byTestId(list, 'spotify-import-jobs')).not.toBeNull();
    expect(textContent(list)).toContain(strings.search.importJobsTitle);
  });
});

describe('SpotifyImportProgress', () => {
  it('shows the running summary, a progress bar and the background hint', () => {
    const progress = SpotifyImportProgress({ job: job() });
    expect(byTestId(progress, 'spotify-import-progress-bar').props.accessibilityValue)
      .toEqual({ min: 0, max: 100, now: 25 });
    expect(textContent(progress)).toEqual(expect.arrayContaining([
      strings.search.importJobProgress(10, 40, 9),
      strings.search.importBackgroundHint,
    ]));
  });

  it('shows the link while Spotify has not named the import yet', () => {
    const progress = SpotifyImportProgress({ job: job({ name: '', type: '', total: 0 }) });
    expect(textContent(progress)).toEqual(expect.arrayContaining([
      strings.search.importReadingLink,
      wireJob.url,
    ]));
  });
});
