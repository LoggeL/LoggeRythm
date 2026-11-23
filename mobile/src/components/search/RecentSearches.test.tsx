import { describe, expect, it, vi } from 'vitest';
import { strings } from '../../localization';
import { byTestId, flatStyle, queryByTestId, textContent } from '../../test/render';
import { RecentSearches } from './RecentSearches';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

describe('RecentSearches', () => {
  it('renders nothing when empty and healthy', () => {
    expect(
      RecentSearches({
        recent: [],
        error: null,
        onSelect: vi.fn(),
        onRemove: vi.fn(),
        onClear: vi.fn(),
      }),
    ).toBeNull();
  });

  it('renders D-Pad focusable chips with select, remove, and clear controls', () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    const onClear = vi.fn();
    const onChipFocus = vi.fn();

    const tree = RecentSearches({
      recent: ['Daft Punk', 'Kraftwerk'],
      error: null,
      onSelect,
      onRemove,
      onClear,
      onChipFocus,
      minTargetHeight: 52,
    });

    expect(byTestId(tree, 'search-recent')).not.toBeNull();
    expect(textContent(tree)).toContain(strings.search.recentTitle);
    expect(textContent(tree)).toContain('Daft Punk');
    expect(textContent(tree)).toContain('Kraftwerk');

    const open0 = byTestId(tree, 'search-recent-open-0');
    const remove1 = byTestId(tree, 'search-recent-remove-1');
    const clear = byTestId(tree, 'search-recent-clear');

    expect(open0.props.focusable).toBe(true);
    expect(open0.props.accessibilityLabel).toBe(strings.search.recentOpen('Daft Punk'));
    expect(flatStyle(open0.props.style).minHeight).toBe(52);
    expect(remove1.props.focusable).toBe(true);
    expect(remove1.props.accessibilityLabel).toBe(strings.search.recentRemove('Kraftwerk'));
    expect(clear.props.focusable).toBe(true);
    expect(clear.props.accessibilityLabel).toBe(strings.search.recentClearLabel);

    (open0.props.onFocus as () => void)();
    expect(onChipFocus).toHaveBeenCalledWith('search-recent-open-0');

    (open0.props.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledWith('Daft Punk');

    (remove1.props.onPress as () => void)();
    expect(onRemove).toHaveBeenCalledWith('Kraftwerk');

    (clear.props.onPress as () => void)();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('surfaces load and save storage failures loudly with real error detail and retry on load error', () => {
    const onRetry = vi.fn();
    const loadFailed = RecentSearches({
      recent: [],
      error: { kind: 'load', detail: 'Saved recent searches are not valid JSON' },
      onSelect: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
      onRetry,
    });

    const notice = byTestId(loadFailed, 'search-recent-error');
    expect(notice.props.accessibilityRole).toBe('alert');
    expect(textContent(notice).join(' ')).toContain(strings.search.recentLoadFailed);
    expect(textContent(notice).join(' ')).toContain('Saved recent searches are not valid JSON');
    expect(queryByTestId(loadFailed, 'search-recent-clear')).toBeNull();
    (byTestId(loadFailed, 'search-recent-error-action').props.onPress as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();

    const saveFailed = RecentSearches({
      recent: ['Daft Punk'],
      error: { kind: 'save', detail: 'quota exceeded' },
      onSelect: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
    });
    const saveNotice = byTestId(saveFailed, 'search-recent-error');
    expect(textContent(saveNotice).join(' ')).toContain(strings.search.recentSaveFailed);
    expect(textContent(saveNotice).join(' ')).toContain('quota exceeded');
    expect(queryByTestId(saveFailed, 'search-recent-error-action')).toBeNull();
  });
});
