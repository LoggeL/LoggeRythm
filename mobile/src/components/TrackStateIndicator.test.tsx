import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { TrackPresentationState } from '../player/trackPresentation';
import TrackStateIndicator, {
  type TrackStateIndicatorCopy,
} from './TrackStateIndicator';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestID(
  node: React.ReactNode,
  testID: string,
): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => element.props.testID === testID) ?? null;
}

const copy: TrackStateIndicatorCopy = {
  playing: 'Playing',
  paused: 'Paused',
  buffering: 'Buffering',
  active: 'Current track',
  downloaded: 'Downloaded',
  serverCached: 'Stored on the server',
  rollingDeviceCache: (seconds) => `Rolling device cache ${seconds}s`,
};

function presentation(
  overrides: Partial<TrackPresentationState> = {},
): TrackPresentationState {
  return {
    active: true,
    playback: 'playing',
    serverCache: 'unknown',
    rollingDeviceCache: null,
    explicitDownload: { kind: 'unknown' },
    ...overrides,
  };
}

describe('TrackStateIndicator', () => {
  it('leaves playing state to the row color instead of rendering a tag', () => {
    const rendered = TrackStateIndicator({ presentation: presentation(), copy });

    expect(rendered).toBeNull();
  });

  it('makes buffering both visible and accessibility-busy', () => {
    const rendered = TrackStateIndicator({
      presentation: presentation({ playback: 'buffering' }),
      copy,
      testID: 'state',
    });

    expect(byTestID(rendered, 'state')?.props).toMatchObject({
      accessibilityLabel: 'Buffering',
      accessibilityState: { selected: true, busy: true },
    });
    expect(byTestID(rendered, 'state-buffering-spinner')?.props.accessible).toBe(false);
  });

  it('renders only positive server and rolling-cache evidence', () => {
    const rendered = TrackStateIndicator({
      presentation: presentation({
        playback: 'paused',
        serverCache: 'cached',
        rollingDeviceCache: { kind: 'rolling-lru', seconds: 61.5 },
      }),
      copy,
    });

    expect(byTestID(rendered, 'track-state')?.props.accessibilityLabel).toBe(
      'Stored on the server. Rolling device cache 61.5s',
    );
    expect(byTestID(rendered, 'track-state-server-cache')).not.toBeNull();
    expect(byTestID(rendered, 'track-state-rolling-cache')).not.toBeNull();
  });

  it('renders a verified explicit download as visible and accessible evidence', () => {
    const rendered = TrackStateIndicator({
      presentation: presentation({
        active: false,
        playback: 'inactive',
        explicitDownload: { kind: 'downloaded' },
      }),
      copy,
    });

    expect(byTestID(rendered, 'track-state')?.props.accessibilityLabel).toBe('Downloaded');
    expect(byTestID(rendered, 'track-state-downloaded')).not.toBeNull();
  });

  it('does not turn unknown/not-cached or absent download into a badge', () => {
    const unknown = TrackStateIndicator({
      presentation: presentation({ active: false, playback: 'inactive' }),
      copy,
    });
    const knownAbsent = TrackStateIndicator({
      presentation: presentation({
        active: false,
        playback: 'inactive',
        serverCache: 'not-cached',
        explicitDownload: { kind: 'not-downloaded' },
      }),
      copy,
    });

    expect(unknown).toBeNull();
    expect(knownAbsent).toBeNull();
  });

  it('can show server evidence on an inactive row but suppresses impossible rolling evidence', () => {
    const rendered = TrackStateIndicator({
      presentation: presentation({
        active: false,
        playback: 'inactive',
        serverCache: 'cached',
        rollingDeviceCache: { kind: 'rolling-lru', seconds: 90 },
      }),
      copy,
    });

    expect(byTestID(rendered, 'track-state')?.props).toMatchObject({
      accessibilityLabel: 'Stored on the server',
      accessibilityState: { selected: false, busy: false },
    });
    expect(byTestID(rendered, 'track-state-server-cache')).not.toBeNull();
    expect(byTestID(rendered, 'track-state-rolling-cache')).toBeNull();
    expect(
      elements(rendered).some((element) => String(element.props.testID).includes('download')),
    ).toBe(false);
  });
});
