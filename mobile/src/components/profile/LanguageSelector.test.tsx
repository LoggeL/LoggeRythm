import type React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { activateLocale } from '../../localization';
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
vi.mock('../../theme', () => ({
  colors: {
    accent: '#f00',
    border: '#333',
    danger: '#f33',
    surface: '#111',
    surfaceElevated: '#222',
    surfacePressed: '#292929',
    textPrimary: '#fff',
    textSecondary: '#aaa',
  },
  metrics: { minimumTouchTarget: 48 },
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestID(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> {
  const found = elements(node).find((element) => element.props.testID === testID);
  if (found === undefined) throw new Error(`No element has testID ${testID}`);
  return found;
}

function textContent(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node === null || typeof node !== 'object' || !('props' in node)) return '';
  return textContent((node as React.ReactElement<ElementProps>).props.children);
}

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
    expect(textContent(byTestID(rendered, 'profile-language-status'))).toBe('Saving language…');
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
    expect(textContent(error)).toBe('The language could not be saved.');
  });
});
