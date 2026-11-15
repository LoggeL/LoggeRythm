import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle, queryByTestId } from '../../test/render';
import { colors, layout } from '../../theme';
import { TrackArtworkOverlay } from './TrackArtworkOverlay';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

function glyphs(node: React.ReactNode): unknown[] {
  return byType(node, 'AppIcon').map((icon) => icon.props.name);
}

describe('TrackArtworkOverlay', () => {
  it('shows the cover with a play affordance while the track is idle', () => {
    const rendered = TrackArtworkOverlay({
      cover: 'https://example.test/cover.jpg',
      size: layout.artwork.sm,
      presentation: { active: false, playback: 'inactive' },
    });

    expect(byType(rendered, 'Image')[0]?.props.source).toEqual({
      uri: 'https://example.test/cover.jpg',
    });
    expect(glyphs(rendered)).toContain('play');
    expect(byType(rendered, 'ActivityIndicator')).toHaveLength(0);
  });

  it('mirrors the live transport state of the active track', () => {
    const playing = TrackArtworkOverlay({
      cover: '',
      size: layout.artwork.sm,
      presentation: { active: true, playback: 'playing' },
    });
    const paused = TrackArtworkOverlay({
      cover: '',
      size: layout.artwork.sm,
      presentation: { active: true, playback: 'paused' },
    });
    const buffering = TrackArtworkOverlay({
      cover: '',
      size: layout.artwork.sm,
      presentation: { active: true, playback: 'buffering' },
    });

    expect(glyphs(playing)).toContain('pause');
    expect(glyphs(paused)).toContain('play');
    expect(byType(buffering, 'ActivityIndicator')[0]?.props.accessible).toBe(false);
    // A missing cover falls back to the placeholder tile, never a broken image.
    expect(byType(playing, 'Image')).toHaveLength(0);
  });

  it('renders a position badge only when given one and tints chart ranks', () => {
    const none = TrackArtworkOverlay({
      cover: '',
      size: layout.artwork.sm,
      presentation: { active: false, playback: 'inactive' },
      badgeTestID: 'row-position',
    });
    expect(queryByTestId(none, 'row-position')).toBeNull();

    const rank = TrackArtworkOverlay({
      cover: '',
      size: layout.artwork.card,
      presentation: { active: false, playback: 'inactive' },
      badge: 3,
      badgeTestID: 'card-rank',
      badgeTone: 'accent',
    });
    const badge = byTestId(rank, 'card-rank');
    expect(badge.props.children).toBe(3);
    expect(badge.props.accessible).toBe(false);
    expect(flatStyle(badge.props.style)).toMatchObject({
      backgroundColor: colors.accent,
      color: colors.onAccent,
    });
  });
});
