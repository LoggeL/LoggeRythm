import { describe, expect, it, vi } from 'vitest';
import type { PlaylistSummary, ResolveResult, Track } from '../../api/types';
import { strings } from '../../localization';
import { byTestId, byType, flatStyle, queryByTestId, textContent } from '../../test/render';
import { SpotifyImportForm } from './SpotifyImportForm';
import { SpotifyImportResultSummary } from './SpotifyImportResultSummary';
import {
  SpotifyImportDestinationRow,
  SpotifyImportSaveControls,
  SpotifyImportUnmatchedHeader,
  SpotifyImportUnmatchedRow,
} from './SpotifyImportRows';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  TextInput: 'TextInput',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

const track: Track = {
  id: '12',
  title: 'Midnight Signal',
  artist: 'LoggeRythm',
  artist_id: '7',
  artists: [{ id: '7', name: 'LoggeRythm' }],
  album: 'Parity',
  album_id: '9',
  cover: '',
  duration_sec: 185,
  preview_url: null,
  rank: 0,
  release_date: '',
};

const result = (overrides: Partial<ResolveResult> = {}): ResolveResult => ({
  type: 'playlist',
  name: 'Road trip',
  image: 'https://img.example/p.jpg',
  total: 3,
  source_total: 3,
  matched: 2,
  tracks: [track, track],
  unmatched: [{ title: 'Lost', artist: 'Nobody' }] as ResolveResult['unmatched'],
  ...overrides,
});

const playlist: PlaylistSummary = {
  id: 5,
  name: 'Favourites',
  description: null,
  cover_url: null,
  is_public: false,
  track_count: 2,
  owner_name: null,
} as PlaylistSummary;

describe('SpotifyImportForm', () => {
  it('keeps the link field, resolve action and input error contracts', () => {
    const onChangeText = vi.fn();
    const onSubmit = vi.fn();
    const empty = SpotifyImportForm({ value: ' ', error: null, onChangeText, onSubmit });

    expect(byTestId(empty, 'spotify-import-panel')).not.toBeNull();
    expect(byTestId(empty, 'spotify-import-input').props).toMatchObject({
      accessibilityLabel: strings.search.importInputLabel,
      keyboardType: 'url',
      returnKeyType: 'go',
      maxLength: 8_192,
      onChangeText,
      onSubmitEditing: onSubmit,
    });
    expect(byTestId(empty, 'spotify-import-resolve').props.disabled).toBe(true);
    expect(queryByTestId(empty, 'spotify-import-input-error')).toBeNull();

    const filled = SpotifyImportForm({
      value: 'https://open.spotify.com/album/1',
      error: 'Invalid link',
      onChangeText,
      onSubmit,
    });
    const resolve = byTestId(filled, 'spotify-import-resolve');
    expect(resolve.props.disabled).toBe(false);
    (resolve.props.onPress as () => void)();
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(byTestId(filled, 'spotify-import-input-error').props.accessibilityRole).toBe('alert');
    expect(textContent(filled)).toContain('Invalid link');
  });
});

describe('SpotifyImportResultSummary', () => {
  const base = { runtimeError: null, saveFeedback: null, playingIndex: null, onPlayAll: vi.fn() };

  it('summarises the match and makes play-all the one loud control', () => {
    const onPlayAll = vi.fn();
    const rendered = SpotifyImportResultSummary({ ...base, result: result(), onPlayAll });
    const play = byTestId(rendered, 'spotify-import-play-all');

    expect(byTestId(rendered, 'spotify-import-result')).not.toBeNull();
    expect(play.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: strings.search.importPlayAll,
      disabled: false,
    });
    (play.props.onPress as () => void)();
    expect(onPlayAll).toHaveBeenCalledOnce();
    expect(textContent(rendered)).toEqual(expect.arrayContaining([
      strings.search.importType.playlist,
      'Road trip',
    ]));
    expect(queryByTestId(rendered, 'spotify-import-runtime-error')).toBeNull();
    expect(queryByTestId(rendered, 'spotify-import-save-success')).toBeNull();
  });

  it('locks play-all without matches or while playback starts, and surfaces outcomes', () => {
    const none = SpotifyImportResultSummary({ ...base, result: result({ tracks: [] }) });
    expect(byTestId(none, 'spotify-import-play-all').props.disabled).toBe(true);

    const starting = SpotifyImportResultSummary({
      ...base,
      result: result({ source_total: 9 }),
      playingIndex: 0,
      runtimeError: 'Playback failed',
      saveFeedback: 'Saved 2 tracks',
    });
    expect(byTestId(starting, 'spotify-import-play-all').props).toMatchObject({
      disabled: true,
      accessibilityState: { busy: true, disabled: true },
    });
    expect(byTestId(starting, 'spotify-import-runtime-error').props.accessibilityLiveRegion)
      .toBe('assertive');
    expect(byTestId(starting, 'spotify-import-save-success').props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'polite',
      children: 'Saved 2 tracks',
    });
    expect(textContent(starting)).toContain(strings.search.importTruncated(9, 3));
  });
});

describe('Spotify import rows', () => {
  it('saves a trimmed new playlist name and locks the form while saving', () => {
    const onSaveNew = vi.fn();
    const onChangeName = vi.fn();
    const idle = SpotifyImportSaveControls({
      name: '  Road trip  ',
      saving: false,
      savingNew: false,
      onChangeName,
      onSaveNew,
    });

    expect(byTestId(idle, 'spotify-import-new-name').props).toMatchObject({
      accessibilityLabel: strings.search.importNewPlaylistName,
      editable: true,
      maxLength: 120,
      onChangeText: onChangeName,
    });
    (byTestId(idle, 'spotify-import-save-new').props.onPress as () => void)();
    expect(onSaveNew).toHaveBeenCalledWith('Road trip');

    const blank = SpotifyImportSaveControls({
      name: '   ', saving: false, savingNew: false, onChangeName, onSaveNew,
    });
    expect(byTestId(blank, 'spotify-import-save-new').props.disabled).toBe(true);

    const saving = SpotifyImportSaveControls({
      name: 'Road trip', saving: true, savingNew: true, onChangeName, onSaveNew,
    });
    expect(byTestId(saving, 'spotify-import-new-name').props.editable).toBe(false);
    expect(byTestId(saving, 'spotify-import-save-new').props.accessibilityState)
      .toEqual({ disabled: true, busy: true });
    expect(textContent(saving)).toContain(strings.search.importSaving);
  });

  it('renders a destination as a full-height row button with busy and locked states', () => {
    const onPress = vi.fn();
    const idle = SpotifyImportDestinationRow({ playlist, saving: false, busy: false, onPress });
    const row = byTestId(idle, 'spotify-import-save-existing-5');

    expect(row.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: strings.search.importSaveToPlaylist('Favourites'),
      accessibilityState: { disabled: false, busy: false },
    });
    expect(flatStyle(row.props.style).minHeight).toBe(64);
    expect(flatStyle(row.props.style, { pressed: true }).opacity).toBe(0.72);
    expect(textContent(idle)).toEqual(['Favourites', strings.common.trackCount(2)]);
    (row.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();

    const busy = SpotifyImportDestinationRow({ playlist, saving: true, busy: true, onPress });
    expect(byTestId(busy, 'spotify-import-save-existing-5').props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
    expect(byType(busy, 'ActivityIndicator')).toHaveLength(1);
  });

  it('lists unmatched source tracks on one truncated line under their heading', () => {
    expect(byTestId(SpotifyImportUnmatchedHeader(), 'spotify-import-unmatched')).not.toBeNull();
    const rendered = SpotifyImportUnmatchedRow({
      track: { title: 'Lost', artist: 'Nobody' } as ResolveResult['unmatched'][number],
    });
    const [line] = byType(rendered, 'Text');

    expect(line.props.numberOfLines).toBe(1);
    expect((line.props.children as string[]).join('')).toBe('Lost — Nobody');
  });
});
