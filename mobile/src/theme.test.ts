import { describe, expect, it } from 'vitest';
import {
  colors,
  elevation,
  layout,
  metrics,
  opacity,
  radii,
  spacing,
  typography,
} from './theme';

function contrast(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const values = [1, 3, 5].map((index) => {
      const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe('production Android color contract', () => {
  it('uses the production violet and exposes every semantic state token', () => {
    expect(colors.accent).toBe('#8f73ff');
    expect(colors.accentSolid).toBe('#7a5cf5');
    expect(colors.backdrop).toBe('#050608');
    expect(colors.background).toBe('#0c0d11');
    expect(colors).toMatchObject({
      background: expect.stringMatching(/^#[0-9a-f]{6}$/u),
      surface: expect.stringMatching(/^#[0-9a-f]{6}$/u),
      textPrimary: expect.stringMatching(/^#[0-9a-f]{6}$/u),
      border: expect.stringMatching(/^#[0-9a-f]{6}$/u),
      success: expect.stringMatching(/^#[0-9a-f]{6}$/u),
      warning: expect.stringMatching(/^#[0-9a-f]{6}$/u),
      danger: expect.stringMatching(/^#[0-9a-f]{6}$/u),
    });
  });

  it('keeps user-state colors distinct from the brand action color', () => {
    expect(new Set([colors.accent, colors.success, colors.warning, colors.danger]).size).toBe(4);
  });

  it('keeps normal text and semantic labels legible on the surfaces that use them', () => {
    for (const surface of [colors.background, colors.surface, colors.surfaceElevated]) {
      for (const text of [colors.textPrimary, colors.textSecondary, colors.accentSoft]) {
        expect(contrast(text, surface), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const surface of [colors.background, colors.surface, colors.surfaceElevated]) {
      expect(contrast(colors.textMuted, surface), `muted on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(colors.onAccent, colors.accentSolid)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onAccent, colors.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onLight, colors.textPrimary)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.danger, colors.dangerSubtle)).toBeGreaterThanOrEqual(4.5);
  });

  it('fits interactive content inside playback and tab surfaces with a separate floating gap', () => {
    expect(metrics.minimumTouchTarget).toBeGreaterThanOrEqual(48);
    expect(metrics.miniPlayerSurfaceHeight).toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
    expect(metrics.tabBarHeight).toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
    expect(metrics.miniPlayerGap).toBeGreaterThan(0);
    expect(spacing.lg).toBe(metrics.pagePadding);
    expect(radii.lg).toBeLessThan(metrics.miniPlayerSurfaceHeight / 2);
    expect(typography.body.lineHeight).toBeGreaterThan(typography.body.fontSize);
  });

  it('exposes the complete type scale with a weight and a readable line height', () => {
    const variants = [
      'display', 'hero', 'title', 'section', 'bodyStrong', 'body',
      'callout', 'caption', 'label', 'micro', 'overline',
    ] as const;
    expect(Object.keys(typography).sort()).toEqual([...variants].sort());
    for (const variant of variants) {
      const token = typography[variant];
      expect(token.lineHeight, variant).toBeGreaterThan(token.fontSize);
      expect(token.fontWeight, variant).toMatch(/^[1-9]00$/u);
    }
    expect(typography.display.fontSize).toBeGreaterThan(typography.hero.fontSize);
    expect(typography.hero.fontSize).toBeGreaterThan(typography.title.fontSize);
    expect(typography.title.fontSize).toBeGreaterThan(typography.section.fontSize);
  });

  it('derives the shell layout from the metrics and keeps state tokens usable', () => {
    expect(layout.tabBarHeight).toBe(metrics.tabBarHeight);
    expect(layout.miniPlayerHeight).toBe(metrics.miniPlayerSurfaceHeight + metrics.miniPlayerGap);
    expect(layout.pagePadding).toBe(metrics.pagePadding);
    expect(layout.rowHeight).toBeGreaterThanOrEqual(metrics.minimumTouchTarget);
    expect(opacity.pressed).toBeGreaterThan(opacity.disabled);
    expect(opacity.disabled).toBeGreaterThan(0);
    expect(elevation.none.elevation).toBe(0);
    expect(elevation.card.elevation).toBeLessThan(elevation.floating.elevation);
    expect(elevation.floating.elevation).toBeLessThan(elevation.sheet.elevation);
    expect(radii.pill).toBeGreaterThan(radii.sheet);
    expect(radii.panel).toBeLessThan(metrics.miniPlayerSurfaceHeight / 2);
  });

  it('pins the header avatar and its notification dot', () => {
    expect(metrics.headerAvatar).toBe(36);
    expect(metrics.badgeDot).toBe(12);
    expect(metrics.badgeDotRing).toBe(2);
    expect(metrics.headerAvatar).toBeLessThan(metrics.minimumTouchTarget);
    // The visible fill inside the ring stays a readable dot.
    expect(metrics.badgeDot - 2 * metrics.badgeDotRing).toBeGreaterThanOrEqual(spacing.xs);
    // headerChrome anchors the dot at the avatar box's top-right corner
    // (inset = the gap between avatar and touch target edge). The dot is
    // larger than that gap, so it overlaps the avatar's corner on purpose…
    const dotInset = (metrics.minimumTouchTarget - metrics.headerAvatar) / 2;
    expect(dotInset).toBeLessThan(metrics.badgeDot);
    // …while staying entirely inside the button's top-right quadrant.
    expect(dotInset).toBeGreaterThanOrEqual(0);
    expect(dotInset + metrics.badgeDot).toBeLessThanOrEqual(metrics.minimumTouchTarget / 2);
  });
});
