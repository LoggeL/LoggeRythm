import { describe, expect, it } from 'vitest';
import { colors } from './theme';

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
});
