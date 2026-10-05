import { describe, expect, it } from 'vitest';
import { colors, metrics, radii, spacing, typography } from './theme';

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
    expect(colors.accent).toBe('#7c5cff');
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
    expect(contrast(colors.onAccent, colors.accentSolid)).toBeGreaterThanOrEqual(4.5);
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
});
