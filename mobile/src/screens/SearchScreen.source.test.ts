import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./SearchScreen.tsx', import.meta.url)), 'utf8');

describe('SearchScreen browsing source', () => {
  it('exposes genre browsing immediately without recent-search hydration UI', () => {
    expect(source).toContain('testID="search-genre-browse"');
    expect(source).toContain('id="search-genres"');
    expect(source).not.toContain('search-history-loading');
    expect(source).not.toContain('search-recent');
    expect(source).not.toContain('AsyncStorage.getItem');
    expect(source).not.toContain('persistRecentSearches');
  });
});
