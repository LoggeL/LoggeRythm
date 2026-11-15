import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateLocale } from '../../localization';
import { byTestId as byTestID, elements, textContent } from '../../test/render';
import { LanguageSelectorView } from './LanguageSelector';

vi.mock('react-native', () => ({
  AccessibilityInfo: { announceForAccessibility: vi.fn() },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../../localization/LocaleProvider', () => ({
  useLocale: vi.fn(),
}));

afterEach(() => {
  activateLocale('de');
});

describe('LanguageSelectorView', () => {
  it('exposes a labelled radio group with the persisted selection', () => {
    activateLocale('de');
    const onSelect = vi.fn();
    const rendered = LanguageSelectorView({
      locale: 'de', ready: true, busy: false, error: null, onSelect,
    });

    expect(elements(rendered).find((element) => element.props.accessibilityRole === 'radiogroup')?.props)
      .toMatchObject({ accessibilityLabel: 'Sprache' });
    expect(byTestID(rendered, 'profile-language-de').props.accessibilityState)
      .toEqual({ checked: true, disabled: false, busy: false });
    expect(byTestID(rendered, 'profile-language-en').props.accessibilityState)
      .toEqual({ checked: false, disabled: false, busy: false });
    (byTestID(rendered, 'profile-language-en').props.onPress as () => void)();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('en');
  });

  it('uses English copy after a runtime switch and blocks interaction while saving', () => {
    activateLocale('en');
    const rendered = LanguageSelectorView({
      locale: 'en', ready: true, busy: true, error: null, onSelect: vi.fn(),
    });

    expect(textContent(byTestID(rendered, 'profile-language'))).toContain('Language');
    expect(textContent(rendered)).toContain('German');
    expect(textContent(byTestID(rendered, 'profile-language-status'))).toEqual(['Saving language…']);
    expect(byTestID(rendered, 'profile-language-de').props.disabled).toBe(true);
    expect(byTestID(rendered, 'profile-language-en').props.disabled).toBe(true);
  });

  it('announces persistence failure assertively without exposing diagnostics', () => {
    activateLocale('en');
    const rendered = LanguageSelectorView({
      locale: 'de', ready: true, busy: false,
      error: 'The language could not be saved.', onSelect: vi.fn(),
    });
    const error = byTestID(rendered, 'profile-language-error');
    expect(error.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
    });
    expect(textContent(error)).toEqual(['The language could not be saved.']);
  });
});
