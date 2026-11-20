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

  it('plays a tapped library match as the seed of its track radio', () => {
    expect(source).toContain('playWithRadio(library.matches[index])');
    expect(source).not.toContain('playTrackRow(library.matches');
  });
});

describe('SearchScreen track playback source', () => {
  it('plays only the tapped result and continues with its track radio', () => {
    expect(source).toContain('void playTrackWithRadio(track)');
    expect(source).toContain('playWithRadio(tracks[index])');
    expect(source).not.toContain('playTrackRow(');
    expect(source).not.toContain("type: 'search'");
  });

  it('routes the top track result through the same radio start', () => {
    expect(source).toContain("case 'track':\n        return play(result.index);");
  });

  it('reports a failed radio separately from a failed playback start', () => {
    expect(source).toContain(
      'error instanceof TrackRadioError ? strings.search.radioFailed : strings.search.playFailed',
    );
  });

  it('marks every row of the playing seed through the radio occurrence', () => {
    expect(source).toContain('occurrence={searchTrackRadioOccurrence(track.id)}');
  });
});
