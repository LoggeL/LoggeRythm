import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import OfflinePlaylistControl, {
  normalizeOfflinePlaylistProgress,
  type OfflinePlaylistControlCopy,
  type OfflinePlaylistControlProps,
} from './OfflinePlaylistControl';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  if (typeof element.type === 'function') {
    const rendered = (element.type as (props: ElementProps) => React.ReactNode)(element.props);
    return [element, ...elements(rendered)];
  }
  return [element, ...elements(element.props.children)];
}

function byTestID(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => (
    element.props.testID === testID && typeof element.type !== 'function'
  )) ?? null;
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textContent((node as React.ReactElement<ElementProps>).props.children);
}

const englishCopy: OfflinePlaylistControlCopy = {
  unavailable: 'Offline downloads are unavailable.',
  idle: 'Save this playlist for offline playback.',
  downloading: ({ completedTracks, totalTracks }) => `Downloading ${completedTracks} of ${totalTracks}.`,
  partial: ({ completedTracks, totalTracks, failedTracks }) => `${completedTracks} of ${totalTracks} saved; ${failedTracks} failed.`,
  downloaded: ({ completedTracks, totalTracks }) => `${completedTracks} of ${totalTracks} downloaded.`,
  removing: ({ completedTracks }) => `Removing ${completedTracks} downloads.`,
  error: ({ completedTracks }) => `Download failed; ${completedTracks} tracks remain.`,
  progress: ({ percent }) => `${percent} percent`,
  downloadAction: 'Download',
  downloadingAction: 'Downloading',
  retryAction: 'Retry',
  removeAction: 'Remove download',
  removingAction: 'Removing',
};

const germanCopy: OfflinePlaylistControlCopy = {
  ...englishCopy,
  unavailable: 'Offline-Downloads sind nicht verfügbar.',
  idle: 'Playlist offline speichern.',
  downloading: ({ completedTracks, totalTracks }) => `${completedTracks} von ${totalTracks} werden geladen.`,
  partial: ({ completedTracks, totalTracks, failedTracks }) => `${completedTracks} von ${totalTracks} gespeichert; ${failedTracks} fehlgeschlagen.`,
  downloaded: ({ completedTracks, totalTracks }) => `${completedTracks} von ${totalTracks} heruntergeladen.`,
  removing: ({ completedTracks }) => `${completedTracks} Downloads werden entfernt.`,
  error: ({ completedTracks }) => `Download fehlgeschlagen; ${completedTracks} Titel bleiben.`,
  progress: ({ percent }) => `${percent} Prozent`,
  downloadAction: 'Herunterladen',
  downloadingAction: 'Wird heruntergeladen',
  retryAction: 'Erneut versuchen',
  removeAction: 'Download entfernen',
  removingAction: 'Wird entfernt',
};

function render(
  overrides: Partial<OfflinePlaylistControlProps> = {},
): React.ReactElement {
  return OfflinePlaylistControl({
    state: { kind: 'idle' },
    copy: englishCopy,
    onDownload: vi.fn(),
    onRetry: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  });
}

describe('OfflinePlaylistControl', () => {
  it('renders unavailable and idle states without owning any side effects', () => {
    const unavailable = render({ state: { kind: 'unavailable' } });
    expect(textContent(unavailable)).toContain(englishCopy.unavailable);
    expect(byTestID(unavailable, 'offline-playlist-control-download')).toBeNull();
    expect(byTestID(unavailable, 'offline-playlist-control-retry')).toBeNull();
    expect(byTestID(unavailable, 'offline-playlist-control-remove')).toBeNull();

    const onDownload = vi.fn();
    const idle = render({ state: { kind: 'idle' }, onDownload });
    const action = byTestID(idle, 'offline-playlist-control-download');
    expect(action?.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: englishCopy.downloadAction,
      accessibilityState: { disabled: false, busy: false },
      disabled: false,
    });
    (action?.props.onPress as () => void)();
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('reports aggregate downloading progress and blocks duplicate work as busy', () => {
    const tree = render({
      state: {
        kind: 'downloading',
        progress: { completedTracks: 3, totalTracks: 8, failedTracks: 1 },
      },
    });
    const status = byTestID(tree, 'offline-playlist-control-status');
    const action = byTestID(tree, 'offline-playlist-control-download');

    expect(status?.props).toMatchObject({
      accessibilityRole: 'progressbar',
      accessibilityLabel: 'Downloading 3 of 8.',
      accessibilityLiveRegion: 'polite',
      accessibilityState: { busy: true },
      accessibilityValue: { min: 0, max: 8, now: 3, text: '38 percent' },
    });
    expect(action?.props).toMatchObject({
      accessibilityLabel: englishCopy.downloadingAction,
      accessibilityState: { disabled: true, busy: true },
      disabled: true,
    });
  });

  it('offers retry and removal for a partial download', () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    const tree = render({
      state: {
        kind: 'partial',
        progress: { completedTracks: 6, totalTracks: 10, failedTracks: 4 },
      },
      onRetry,
      onRemove,
    });

    expect(textContent(tree)).toContain('6 of 10 saved; 4 failed.');
    expect(byTestID(tree, 'offline-playlist-control-status')?.props.accessibilityValue)
      .toEqual({ min: 0, max: 10, now: 6, text: '60 percent' });
    (byTestID(tree, 'offline-playlist-control-retry')?.props.onPress as () => void)();
    (byTestID(tree, 'offline-playlist-control-remove')?.props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('renders downloaded and removing states with correct button semantics', () => {
    const progress = { completedTracks: 9, totalTracks: 9, failedTracks: 0 };
    const downloaded = render({ state: { kind: 'downloaded', progress } });
    expect(byTestID(downloaded, 'offline-playlist-control-remove')?.props)
      .toMatchObject({ disabled: false, accessibilityState: { disabled: false, busy: false } });

    const removing = render({ state: { kind: 'removing', progress } });
    expect(byTestID(removing, 'offline-playlist-control-status')?.props)
      .toMatchObject({ accessibilityRole: 'progressbar', accessibilityState: { busy: true } });
    expect(byTestID(removing, 'offline-playlist-control-remove')?.props).toMatchObject({
      accessibilityLabel: englishCopy.removingAction,
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
  });

  it('announces errors without diagnostics and supports retry plus safe cleanup', () => {
    const tree = render({
      state: {
        kind: 'error',
        progress: { completedTracks: 2, totalTracks: 7, failedTracks: 1 },
      },
    });
    const status = byTestID(tree, 'offline-playlist-control-status');

    expect(status?.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
      accessibilityLabel: 'Download failed; 2 tracks remain.',
    });
    expect(textContent(tree)).not.toContain('cookie');
    expect(byTestID(tree, 'offline-playlist-control-retry')).not.toBeNull();
    expect(byTestID(tree, 'offline-playlist-control-remove')).not.toBeNull();
  });

  it('honors an external disabled gate and accepts runtime German copy', () => {
    const onDownload = vi.fn();
    const tree = render({
      copy: germanCopy,
      disabled: true,
      onDownload,
      testID: 'playlist-offline',
    });
    const action = byTestID(tree, 'playlist-offline-download');

    expect(textContent(tree)).toContain(germanCopy.idle);
    expect(action?.props).toMatchObject({
      accessibilityLabel: germanCopy.downloadAction,
      accessibilityState: { disabled: true, busy: false },
      disabled: true,
    });
  });

  it('sanitizes malformed progress before exposing it to copy or accessibility', () => {
    expect(normalizeOfflinePlaylistProgress({
      completedTracks: 99.8,
      totalTracks: 5.9,
      failedTracks: Number.POSITIVE_INFINITY,
    })).toEqual({ completedTracks: 5, totalTracks: 5, failedTracks: 0, percent: 100 });
    expect(normalizeOfflinePlaylistProgress({
      completedTracks: -3,
      totalTracks: Number.NaN,
      failedTracks: -1,
    })).toEqual({ completedTracks: 0, totalTracks: 0, failedTracks: 0, percent: 0 });
  });
});
