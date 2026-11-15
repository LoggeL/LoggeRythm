import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { SEARCH_SORTS, SEARCH_TABS } from '../../screens/searchModel';
import { byTestId, flatStyle, queryByTestId } from '../../test/render';
import { SearchBar } from './SearchBar';
import { SearchSortControls, SearchTabs, searchSortLabel } from './SearchFilters';
import { SpotifyImportToggle } from './SpotifyImportToggle';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('SearchBar', () => {
  it('is a labelled pill input that submits as a search', () => {
    const onChangeText = vi.fn();
    const onSubmit = vi.fn();
    const rendered = SearchBar({ value: '', onChangeText, onSubmit });
    const input = byTestId(rendered, 'search-input');

    expect(input.props).toMatchObject({
      accessibilityLabel: strings.search.inputLabel,
      placeholder: strings.search.placeholder,
      returnKeyType: 'search',
      autoCapitalize: 'none',
      autoCorrect: false,
      onChangeText,
      onSubmitEditing: onSubmit,
    });
    expect(flatStyle(input.props.style).minHeight).toBe(48);
    expect(flatStyle(rendered.props.style).borderRadius).toBe(999);
    expect(queryByTestId(rendered, 'search-clear')).toBeNull();
  });

  it('offers a 48dp clear control only while there is text', () => {
    const onChangeText = vi.fn();
    const rendered = SearchBar({ value: 'kraft', onChangeText, onSubmit: vi.fn() });
    const clear = byTestId(rendered, 'search-clear');

    expect(clear.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: strings.search.clear,
    });
    expect(flatStyle(clear.props.style)).toMatchObject({ width: 48, height: 48 });
    (clear.props.onPress as () => void)();
    expect(onChangeText).toHaveBeenCalledWith('');
  });
});

describe('search filters', () => {
  it('exposes every result type as a tab with exactly one selected', () => {
    const onSelect = vi.fn();
    const rendered = SearchTabs({ tab: 'album', onSelect });

    expect(rendered.props.accessibilityRole).toBe('tablist');
    for (const tab of SEARCH_TABS) {
      expect(byTestId(rendered, `search-tab-${tab}`).props).toMatchObject({
        accessibilityRole: 'tab',
        accessibilityLabel: strings.search.tabs[tab],
        accessibilityState: { selected: tab === 'album', disabled: false },
      });
    }
    (byTestId(rendered, 'search-tab-artist').props.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledWith('artist');
  });

  it('labels every sort and reports the active one', () => {
    const onSelect = vi.fn();
    const rendered = SearchSortControls({ sort: 'dur-asc', onSelect });

    expect(rendered.props.testID).toBe('search-sort-controls');
    for (const sort of SEARCH_SORTS) {
      expect(byTestId(rendered, `search-sort-${sort}`).props).toMatchObject({
        accessibilityRole: 'button',
        accessibilityLabel: searchSortLabel(sort),
        accessibilityState: { selected: sort === 'dur-asc', disabled: false },
      });
    }
    expect(searchSortLabel('dur-desc')).toBe(strings.search.sorts.durationDescending);
    (byTestId(rendered, 'search-sort-title').props.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledWith('title');
  });
});

describe('SpotifyImportToggle', () => {
  it.each([
    [false, () => strings.search.importOpen],
    [true, () => strings.search.importClose],
  ])('reports expanded=%s with the matching label', (expanded, label) => {
    const onToggle = vi.fn();
    const rendered = SpotifyImportToggle({ expanded, onToggle });
    const toggle = byTestId(rendered, 'spotify-import-toggle');

    expect(toggle.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: label(),
      accessibilityState: { expanded },
    });
    expect(flatStyle(toggle.props.style).minHeight).toBe(48);
    expect(flatStyle(toggle.props.style, { pressed: true }).opacity).toBe(0.72);
    (toggle.props.onPress as () => void)();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
