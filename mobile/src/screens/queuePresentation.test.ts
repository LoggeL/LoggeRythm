import { describe, expect, it } from 'vitest';
import type { QueueContextMetadata, QueueOrigin } from '../player/queueContract';
import {
  buildQueuePresentation,
  contextLabelForSection,
  type IndexedQueueRow,
} from './queuePresentation';

interface FixtureRow {
  id: string;
  origin: QueueOrigin;
  context: QueueContextMetadata | null;
}

const playlist: QueueContextMetadata = {
  type: 'playlist',
  id: 'playlist-42',
  label: 'Road-trip mix',
};

function row(
  id: string,
  origin: QueueOrigin,
  context: QueueContextMetadata | null = playlist,
): FixtureRow {
  return { id, origin, context };
}

describe('queue presentation contract', () => {
  it('separates retained history, current, manual upcoming, and context upcoming', () => {
    const presentation = buildQueuePresentation(
      [
        row('history-context', 'context'),
        row('history-manual', 'manual'),
        row('current', 'context'),
        row('manual-1', 'manual'),
        row('manual-2', 'manual'),
        row('context-1', 'context'),
        row('context-2', 'context'),
      ],
      2,
    );

    expect(
      presentation.sections.map((section) => ({
        kind: section.kind,
        ids: section.data.map((entry) => entry.row.id),
        nativeIndexes: section.data.map((entry) => entry.nativeIndex),
      })),
    ).toEqual([
      { kind: 'history', ids: ['history-context', 'history-manual'], nativeIndexes: [0, 1] },
      { kind: 'current', ids: ['current'], nativeIndexes: [2] },
      { kind: 'manual', ids: ['manual-1', 'manual-2'], nativeIndexes: [3, 4] },
      { kind: 'context', ids: ['context-1', 'context-2'], nativeIndexes: [5, 6] },
    ]);
    expect(presentation.historyCount).toBe(2);
    expect(presentation.upcomingCount).toBe(4);
  });

  it('treats every row as upcoming when the native queue has no active item', () => {
    const presentation = buildQueuePresentation(
      [row('manual', 'manual', null), row('context', 'context')],
      null,
    );

    expect(presentation.sections.map((section) => section.kind)).toEqual([
      'manual',
      'context',
    ]);
    expect(presentation.upcomingCount).toBe(2);
    expect(presentation.historyCount).toBe(0);
  });

  it('does not count retained history or the current row as upcoming', () => {
    const presentation = buildQueuePresentation(
      [row('history', 'context'), row('current', 'context')],
      1,
    );

    expect(presentation.sections.map((section) => section.kind)).toEqual([
      'history',
      'current',
    ]);
    expect(presentation.upcomingCount).toBe(0);
  });

  it('rejects an active index that cannot address the canonical native queue', () => {
    expect(() => buildQueuePresentation([row('only', 'context')], -1)).toThrow(
      'active index -1 is outside 1 rows',
    );
    expect(() => buildQueuePresentation([row('only', 'context')], 1)).toThrow(
      'active index 1 is outside 1 rows',
    );
  });

  it('uses the persisted human-readable label for the semantic context heading', () => {
    const entries: IndexedQueueRow<FixtureRow>[] = [
      { row: row('one', 'context'), nativeIndex: 3 },
      { row: row('two', 'context'), nativeIndex: 4 },
    ];
    expect(contextLabelForSection(entries, (type) => `Legacy ${type}`, 'Unknown')).toBe(
      'Road-trip mix',
    );
  });

  it('has explicit fallbacks for restored pre-label and metadata-free queues', () => {
    const preLabel = row('legacy-context', 'context', {
      type: 'album',
      id: 'album-1',
      label: null,
    });
    expect(
      contextLabelForSection(
        [{ row: preLabel, nativeIndex: 1 }],
        (type) => `Legacy ${type}`,
        'Unknown',
      ),
    ).toBe('Legacy album');
    expect(
      contextLabelForSection(
        [{ row: row('native', 'context', null), nativeIndex: 1 }],
        (type) => `Legacy ${type}`,
        'Unknown',
      ),
    ).toBe('Unknown');
  });

  it('rejects conflicting semantic contexts and labels deterministically', () => {
    const album = row('album', 'context', { type: 'album', id: 'a', label: 'Album A' });
    const artist = row('artist', 'context', { type: 'artist', id: 'b', label: 'Artist B' });
    expect(() =>
      contextLabelForSection(
        [
          { row: album, nativeIndex: 1 },
          { row: artist, nativeIndex: 2 },
        ],
        (type) => type,
        'Unknown',
      ),
    ).toThrow('conflicting semantic contexts');

    const renamed = row('renamed', 'context', {
      type: 'album',
      id: 'a',
      label: 'Renamed A',
    });
    expect(() =>
      contextLabelForSection(
        [
          { row: album, nativeIndex: 1 },
          { row: renamed, nativeIndex: 2 },
        ],
        (type) => type,
        'Unknown',
      ),
    ).toThrow('conflicting semantic context labels');
  });
});
