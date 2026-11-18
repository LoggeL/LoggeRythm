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

describe('SearchScreen library section source', () => {
  it('matches saved tracks against the current input, not the debounced query', () => {
    expect(source).toContain(
      'useSearchLibrary({ accountScope, input: normalizedInput, tab })',
    );
    expect(source).toContain('libraryTrackIds: library.shownIds');
  });

  it('builds rows for every searchable input, before the remote search is ready', () => {
    expect(source).toContain('const searchRows = inputIsSearchable');
    expect(source).toContain('libraryTracks: library.shown');
    expect(source).toContain('remoteStatus: true');
    expect(source).toContain('testID="search-section-library"');
    expect(source).toContain('strings.search.sections.library');
  });

  it('keeps the remote loading feedback as the row below the library section', () => {
    expect(source).toContain("case 'remote-status':\n        return remoteStatus;");
    expect(source).toContain('testID="search-debounce-status"');
    expect(source).toContain('<SearchResultsFeedback');
  });

  it('reports a failed likes query inside the library section instead of hiding it', () => {
    expect(source).toContain('libraryNotice: library.likesIssue !== null');
    expect(source).toContain('<SearchLibraryLikesNotice');
    expect(source).toContain('onRetry={library.likesIssue.retry}');
    expect(source).toContain("throw new Error('Library notice row rendered without a likes issue')");
  });

  it('plays library matches as their own queue context', () => {
    expect(source).toContain('playTrackRow(library.matches, index');
    expect(source).toContain('id: searchLibraryContextId(normalizedInput)');
    expect(source).toContain('strings.queue.searchLibraryContext(normalizedInput)');
    expect(source).toContain('searchLibraryTrackOccurrence(normalizedInput, index)');
  });
});
