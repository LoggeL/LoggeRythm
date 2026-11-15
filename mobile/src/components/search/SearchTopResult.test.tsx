import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../api/types';
import { strings } from '../../localization';
import { byTestId, byType, textContent } from '../../test/render';
import { colors } from '../../theme';
import { SearchTopResultCard } from './SearchTopResult';

vi.mock('react-native', () => ({
  Image: 'Image',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));
vi.mock('../ui', async (original) => ({
  ...(await original<typeof import('../ui')>()),
  PressableScale: 'PressableScale',
}));

const track: Track = {
  id: '12',
  title: 'Midnight Signal',
  artist: 'LoggeRythm',
  artist_id: '7',
  artists: [{ id: '7', name: 'LoggeRythm' }],
  album: 'Parity',
  album_id: '9',
  cover: 'https://img.example/cover.jpg',
  duration_sec: 185,
  preview_url: null,
  rank: 0,
  release_date: '',
};

describe('SearchTopResultCard', () => {
  it('presents a track as one play button with long-press actions', () => {
    const onPress = vi.fn();
    const onLongPress = vi.fn();
    const rendered = SearchTopResultCard({
      result: { kind: 'track', track, index: 0 },
      onPress,
      onLongPress,
    });
    const card = byTestId(rendered, 'search-top-result');

    expect(byTestId(rendered, 'search-section-top-result')).not.toBeNull();
    expect(card.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel:
        `${strings.search.topResult}: ${strings.common.trackBy('Midnight Signal', 'LoggeRythm')}`,
      onLongPress,
    });
    expect(textContent(rendered)).toEqual([
      strings.search.topResult,
      'Midnight Signal',
      `${strings.search.tabs.track} · LoggeRythm`,
    ]);
    // The accent disc is the only place that uses ink-on-accent.
    expect(byType(rendered, 'AppIcon').at(-1)?.props).toMatchObject({
      name: 'play',
      color: colors.onAccent,
    });
    (card.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('presents an artist as a round, navigating card without a play glyph', () => {
    const rendered = SearchTopResultCard({
      result: { kind: 'artist', artist: { id: '9', name: 'Kraftwerk', picture: '' } },
      onPress: vi.fn(),
    });

    expect(byTestId(rendered, 'search-top-result').props.accessibilityLabel)
      .toBe(`${strings.search.topResult}: ${strings.search.openArtist('Kraftwerk')}`);
    expect(byType(rendered, 'AppIcon').at(-1)?.props.name).toBe('chevron-right');
    expect(byType(rendered, 'Image')).toHaveLength(0);
  });

  it('names album and artist for an album hit and truncates long titles', () => {
    const rendered = SearchTopResultCard({
      result: {
        kind: 'album',
        album: { id: '4', title: 'Autobahn', artistName: 'Kraftwerk', artworkUrl: null },
      },
      onPress: vi.fn(),
    });

    expect(byTestId(rendered, 'search-top-result').props.accessibilityLabel)
      .toBe(`${strings.search.topResult}: ${strings.search.openAlbum('Autobahn', 'Kraftwerk')}`);
    const [, title, subtitle] = byType(rendered, 'Text');
    expect(title.props.numberOfLines).toBe(2);
    expect(subtitle.props.numberOfLines).toBe(1);
  });
});
