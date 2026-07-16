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
  const context: IndexedQueueRow<T>[] = [];

  rows.forEach((row, nativeIndex) => {
    const entry = { row, nativeIndex };
    if (activeIndex !== null && nativeIndex < activeIndex) {
      history.push(entry);
    } else if (nativeIndex === activeIndex) {
      current.push(entry);
    } else if (row.origin === 'manual') {
      manual.push(entry);
    } else {
      context.push(entry);
    }
  });

  const sections: QueuePresentationSection<T>[] = [];
  if (history.length > 0) sections.push({ kind: 'history', data: history });
  if (current.length > 0) sections.push({ kind: 'current', data: current });
  if (manual.length > 0) sections.push({ kind: 'manual', data: manual });
  if (context.length > 0) sections.push({ kind: 'context', data: context });

  return {
    sections,
    historyCount: history.length,
    upcomingCount: manual.length + context.length,
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
