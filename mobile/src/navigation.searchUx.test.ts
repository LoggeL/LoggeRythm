import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./navigation.tsx', import.meta.url)), 'utf8');

describe('native navigation search placement', () => {
  it('keeps SearchTab route identity in the exact middle bottom-tab position', () => {
    const tabNames = [...source.matchAll(/<Tab\.Screen\s+name="([^"]+)"/g)].map((match) => match[1]);

    expect(tabNames.slice(0, 5)).toEqual([
      'HomeTab',
      'DiscoverTab',
      'SearchTab',
      'RadioTab',
      'LibraryTab',
    ]);
    expect(tabNames.indexOf('SearchTab')).toBe(Math.floor(tabNames.slice(0, 5).length / 2));
    expect(source).toContain("tabBarButtonTestID: 'tab-search'");
    expect(source).toContain('tabBarAccessibilityLabel: strings.navigation.search');
  });

  it('routes the Home search action to the existing Search screen without replacing Home state', () => {
    expect(source).toContain("onOpenSearch={() => navigation.navigate('Search')}");
  });
});
