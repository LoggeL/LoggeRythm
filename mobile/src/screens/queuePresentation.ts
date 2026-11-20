import type {
  QueueContextMetadata,
  QueueContextType,
  QueueOrigin,
} from '../player/queueContract';

export type QueueSectionKind = 'history' | 'current' | 'manual' | 'context';

export interface QueuePresentationSource {
  origin: QueueOrigin;
  context: QueueContextMetadata | null;
}

export interface IndexedQueueRow<T> {
  row: T;
  /** Index in the canonical native queue, never the rendered section index. */
  nativeIndex: number;
}

export interface QueuePresentationSection<T> {
  kind: QueueSectionKind;
  /** Unique per section: a queue can hold several context runs (album, then its autoplay radio). */
  key: string;
  data: IndexedQueueRow<T>[];
}

export interface QueuePresentation<T> {
  sections: QueuePresentationSection<T>[];
  historyCount: number;
  upcomingCount: number;
}

export function buildQueuePresentation<T extends QueuePresentationSource>(
  rows: readonly T[],
  activeIndex: number | null,
): QueuePresentation<T> {
  if (
    activeIndex !== null &&
    (!Number.isInteger(activeIndex) || activeIndex < 0 || activeIndex >= rows.length)
  ) {
    throw new Error(
      `Queue presentation active index ${String(activeIndex)} is outside ${rows.length} rows`,
    );
  }

  const history: IndexedQueueRow<T>[] = [];
  const current: IndexedQueueRow<T>[] = [];
  const manual: IndexedQueueRow<T>[] = [];
  // Consecutive upcoming rows of one semantic context form one run. Autoplay
  // appends a track radio after an album, so the upcoming context is no longer
  // a single source; each run keeps native order and gets its own heading.
  const contextRuns: IndexedQueueRow<T>[][] = [];
  let lastContextKey: string | null = null;

  rows.forEach((row, nativeIndex) => {
    const entry = { row, nativeIndex };
    if (activeIndex !== null && nativeIndex < activeIndex) {
      history.push(entry);
    } else if (nativeIndex === activeIndex) {
      current.push(entry);
    } else if (row.origin === 'manual') {
      manual.push(entry);
    } else {
      const key = row.context === null ? 'legacy' : `${row.context.type}:${row.context.id}`;
      if (key !== lastContextKey || contextRuns.length === 0) contextRuns.push([]);
      contextRuns[contextRuns.length - 1].push(entry);
      lastContextKey = key;
    }
  });

  const sections: QueuePresentationSection<T>[] = [];
  if (history.length > 0) sections.push({ kind: 'history', key: 'history', data: history });
  if (current.length > 0) sections.push({ kind: 'current', key: 'current', data: current });
  if (manual.length > 0) sections.push({ kind: 'manual', key: 'manual', data: manual });
  contextRuns.forEach((data, run) => {
    sections.push({ kind: 'context', key: run === 0 ? 'context' : `context-${run + 1}`, data });
  });
  const contextCount = contextRuns.reduce((total, run) => total + run.length, 0);

  return {
    sections,
    historyCount: history.length,
    upcomingCount: manual.length + contextCount,
  };
}

export function contextLabelForSection<T extends QueuePresentationSource>(
  entries: readonly IndexedQueueRow<T>[],
  legacyLabel: (type: QueueContextType) => string,
  unknownLabel: string,
): string {
  if (entries.length === 0) {
    throw new Error('A queue context heading requires at least one row');
  }

  const contexts = entries
    .map((entry) => entry.row.context)
    .filter((context): context is QueueContextMetadata => context !== null);
  if (contexts.length === 0) return unknownLabel;

  const canonical = contexts[0];
  if (
    contexts.some(
      (context) => context.type !== canonical.type || context.id !== canonical.id,
    )
  ) {
    throw new Error('Upcoming queue rows contain conflicting semantic contexts');
  }

  const labels = new Set(
    contexts
      .map((context) => context.label)
      .filter((label): label is string => label !== null),
  );
  if (labels.size > 1) {
    throw new Error('Upcoming queue rows contain conflicting semantic context labels');
  }
  return labels.values().next().value ?? legacyLabel(canonical.type);
}

export type QueueTailContinuation = 'radio' | 'autoplay' | 'stop';

export interface QueueTailInput {
  /** Whether the last queued row is itself a track-radio row. */
  lastRowIsRadio: boolean | null;
  autoRadioEnabled: boolean;
  repeatOff: boolean;
  /** A party owns its queue; Autoplay never extends it. */
  partyQueue: boolean;
}

/**
 * What happens after the last queued track: an explicit radio keeps extending
 * itself, Autoplay turns any other queue into a track radio, otherwise playback
 * stops. Null when nothing ends (empty queue, repeat on) or a party owns it.
 */
export function queueTailContinuation(input: QueueTailInput): QueueTailContinuation | null {
  if (input.lastRowIsRadio === null || !input.repeatOff || input.partyQueue) return null;
  if (input.lastRowIsRadio) return 'radio';
  return input.autoRadioEnabled ? 'autoplay' : 'stop';
}
