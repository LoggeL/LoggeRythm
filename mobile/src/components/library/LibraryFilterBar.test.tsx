import { describe, expect, it, vi } from 'vitest';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, byType } from '../../test/render';
import { LibraryFilterBar, libraryFilterLabel } from './LibraryFilterBar';
import { LIBRARY_FILTER_ORDER, LIBRARY_SECTION_ORDER } from './LibraryVirtualizedList';

vi.mock('react-native', () => ({
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('LibraryFilterBar', () => {
  it('offers the overview first and then one tab per section in product order', () => {
    const bar = LibraryFilterBar({ filter: 'all', onChange: vi.fn() });

    expect(LIBRARY_FILTER_ORDER).toEqual(['all', ...LIBRARY_SECTION_ORDER]);
    expect(byTestId(bar, 'library-filters').props).toMatchObject({
      horizontal: true,
      accessibilityRole: 'tablist',
      accessibilityLabel: libraryStrings.library.filters,
    });
    expect(byType(bar, 'Pressable').map((chip) => chip.props.testID)).toEqual(
      LIBRARY_FILTER_ORDER.map((id) => `library-filter-${id}`),
    );
    expect(byType(bar, 'Pressable').map((chip) => chip.props.accessibilityLabel)).toEqual(
      LIBRARY_FILTER_ORDER.map(libraryFilterLabel),
    );
  });

  it('marks exactly the active filter as the selected tab and reports presses', () => {
    const onChange = vi.fn();
    const bar = LibraryFilterBar({ filter: 'downloads', onChange });

    const selected = byType(bar, 'Pressable')
      .filter((chip) => (chip.props.accessibilityState as { selected: boolean }).selected)
      .map((chip) => chip.props.testID);
    expect(selected).toEqual(['library-filter-downloads']);
    expect(byTestId(bar, 'library-filter-downloads').props.accessibilityRole).toBe('tab');

    (byTestId(bar, 'library-filter-liked').props.onPress as () => void)();
    expect(onChange).toHaveBeenCalledExactlyOnceWith('liked');
  });
});
