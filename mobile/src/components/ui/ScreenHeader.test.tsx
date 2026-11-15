import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { colors, typography } from '../../theme';
import { ScreenHeader } from './ScreenHeader';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

describe('ScreenHeader', () => {
  it('renders the title as a hero-sized accessibility header', () => {
    const rendered = ScreenHeader({ title: 'Bibliothek', testID: 'header', titleTestID: 'header-title' });
    const title = byTestId(rendered, 'header-title');
    expect(byTestId(rendered, 'header').type).toBe('View');
    expect(title.props.accessibilityRole).toBe('header');
    expect(flatStyle(title.props.style)).toMatchObject({ ...typography.hero, color: colors.textPrimary });
    expect(textContent(rendered)).toEqual(['Bibliothek']);
  });

  it('adds eyebrow, subtitle and trailing actions only when given', () => {
    const action = React.createElement('Action', { testID: 'header-action' });
    const rendered = ScreenHeader({
      title: 'Entdecken',
      eyebrow: 'Für dich',
      subtitle: 'Neu diese Woche',
      action,
    });
    expect(textContent(rendered)).toEqual(['Für dich', 'Entdecken', 'Neu diese Woche']);
    expect(flatStyle(byType(rendered, 'Text')[0].props.style)).toMatchObject(typography.overline);
    expect(queryByTestId(rendered, 'header-action')).not.toBeNull();
    expect(queryByTestId(ScreenHeader({ title: 'Entdecken' }), 'header-action')).toBeNull();
  });
});
