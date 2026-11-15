import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { layout, metrics, typography } from '../../theme';
import { SectionHeader } from './SectionHeader';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

describe('SectionHeader', () => {
  it('renders a section heading with the page gutter and no link by default', () => {
    const rendered = SectionHeader({ title: 'Deine Mixe', subtitle: 'Täglich neu', testID: 'mixes-header' });
    const root = byTestId(rendered, 'mixes-header');
    expect(flatStyle(root.props.style).paddingHorizontal).toBe(layout.pagePadding);
    const [title] = byType(rendered, 'Text');
    expect(title.props.accessibilityRole).toBe('header');
    expect(flatStyle(title.props.style)).toMatchObject(typography.section);
    expect(textContent(rendered)).toEqual(['Deine Mixe', 'Täglich neu']);
    expect(byType(rendered, 'Pressable')).toHaveLength(0);
  });

  it('adds a localized 48dp show-all link that names its section', () => {
    const onShowAll = vi.fn();
    const rendered = SectionHeader({
      title: 'Neue Alben',
      onShowAll,
      showAllTestID: 'albums-show-all',
      padded: false,
    });
    expect(flatStyle(rendered.props.style).paddingHorizontal).toBeUndefined();
    const link = byTestId(rendered, 'albums-show-all');
    expect(link.props.accessibilityRole).toBe('button');
    expect(link.props.accessibilityLabel).toBe(`${strings.common.showAll}: Neue Alben`);
    expect(flatStyle(link.props.style).minHeight).toBe(metrics.minimumTouchTarget);
    expect(textContent(rendered)).toEqual(['Neue Alben', strings.common.showAll]);
    (link.props.onPress as () => void)();
    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it('accepts custom link wording and a custom trailing node', () => {
    const custom = SectionHeader({
      title: 'Charts',
      onShowAll: vi.fn(),
      showAllLabel: 'Mehr',
      showAllAccessibilityLabel: 'Alle Charts anzeigen',
      showAllTestID: 'link',
    });
    expect(byTestId(custom, 'link').props.accessibilityLabel).toBe('Alle Charts anzeigen');
    expect(textContent(custom)).toContain('Mehr');

    const trailing = SectionHeader({
      title: 'Charts',
      onShowAll: vi.fn(),
      showAllTestID: 'link',
      trailing: React.createElement('Trailing', { testID: 'trailing' }),
    });
    expect(queryByTestId(trailing, 'trailing')).not.toBeNull();
    expect(queryByTestId(trailing, 'link')).toBeNull();
  });
});
