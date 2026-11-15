import { describe, expect, it, vi } from 'vitest';
import { flatStyle } from '../../test/render';
import { colors, typography } from '../../theme';
import { AppText } from './AppText';

vi.mock('react-native', () => ({ Text: 'Text' }));

describe('AppText', () => {
  it('defaults to primary body copy from the type scale', () => {
    const rendered = AppText({ children: 'Hallo' });
    expect(rendered.type).toBe('Text');
    expect(flatStyle(rendered.props.style)).toEqual({
      ...typography.body,
      color: colors.textPrimary,
    });
  });

  it('maps variant, colour and alignment, with style overrides applied last', () => {
    const rendered = AppText({
      variant: 'overline',
      color: 'accent',
      align: 'center',
      numberOfLines: 1,
      testID: 'eyebrow',
      style: { flex: 1 },
      children: 'Neu',
    });
    expect(flatStyle(rendered.props.style)).toEqual({
      ...typography.overline,
      color: colors.accentSoft,
      textAlign: 'center',
      flex: 1,
    });
    expect(rendered.props.numberOfLines).toBe(1);
    expect(rendered.props.testID).toBe('eyebrow');
  });
});
