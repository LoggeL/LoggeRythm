import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./SearchScreen.tsx', import.meta.url)), 'utf8');

describe('SearchScreen browsing & recent searches source', () => {
  it('exposes genre browsing immediately alongside account-scoped RecentSearches', () => {
    expect(source).toContain('testID="search-genre-browse"');
    expect(source).toContain('id="search-genres"');
    expect(source).toContain('useRecentSearches(accountScope)');
    expect(source).toContain('<RecentSearches');
    expect(source).not.toContain('search-history-loading');
    expect(source).not.toContain('AsyncStorage.getItem');
  });

  it('does not subscribe to 1Hz useProgress ticks', () => {
    expect(source).not.toContain('useProgress');
    expect(source).not.toContain('activeProgress');
  });

  it('wires Android BackHandler for Spotify Import -> clear query -> tab back and TV focus scope', () => {
    expect(source).toContain('useBackHandler(isFocused && (importing || input.length > 0), handleBack)');
    expect(source).toContain('<TvFocusScope scope={SEARCH_TV_SCOPE}>');
    expect(source).toContain('useTvFocusReturn(');
    expect(source).toContain("tvFocusRegistry.register(\n      'search-input',");
    expect(source).toContain('tv.isTv && isFocused && requestedInputFocus');
    expect(source).not.toContain('pushCheckpoint(');
  });

  it('avoids flashing TrackRowSkeleton on keystroke debounce and preserves real playlist error detail', () => {
    expect(source).toContain('<SearchLoadingStatus\n        testID="search-debounce-status"');
    expect(source).not.toContain('<TrackRowSkeleton\n      testID="search-debounce-status"');
    expect(source).toContain("console.error('Search playlist playback failed', error)");
    expect(source).toContain('formatSearchErrorDetail(error)');
  });
});

describe('SearchScreen library section source', () => {
  it('matches saved tracks against the current input, not the debounced query', () => {
    expect(source).toContain(
      'useSearchLibrary({ accountScope, input: normalizedInput, tab })',
    );
    expect(source).toContain('libraryTrackIds: library.shownIds');
  });

  it('builds memoized rows for every searchable input, before the remote search is ready', () => {
    expect(source).toContain('const searchRows = useMemo(');
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

  it('plays the track the top-result card shows, through the same radio start', () => {
    // Not `play(result.index)`: that index addresses the list below the
    // library section, which omits liked recordings the card may still show.
    expect(source).toContain('return playWithRadio(result.track);');
    expect(source).not.toContain('play(result.index)');
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
