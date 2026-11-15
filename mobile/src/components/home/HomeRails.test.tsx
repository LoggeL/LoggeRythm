import { describe, expect, it, vi } from 'vitest';
import type { HomeShelf, Track } from '../../api/types';
import { byTestId, type TestElement } from '../../test/render';
import { HomeShelfRail, HomeTrackRail } from './HomeRails';

vi.mock('react-native', () => ({
  FlatList: 'FlatList',
  StyleSheet: { create: <T,>(styles: T): T => styles },
}));
vi.mock('./HomeCards', () => ({ HomeShelfCard: 'HomeShelfCard', HomeTrackCard: 'HomeTrackCard' }));

const tracks = [
  { id: 'A 1', title: 'One' },
  { id: 'A 1', title: 'One again' },
] as Track[];
const context = { type: 'chart' as const, id: 'home', label: 'Charts' };

function renderRow<T>(rail: TestElement, index: number): TestElement {
  const data = rail.props.data as T[];
  const renderItem = rail.props.renderItem as (info: { item: T; index: number }) => TestElement;
  return renderItem({ item: data[index], index });
}

describe('HomeTrackRail', () => {
  it('renders a horizontal rail whose cards carry their exact queue occurrence', () => {
    const onPlay = vi.fn();
    const onActions = vi.fn();
    const rail = byTestId(
      HomeTrackRail({
        id: 'charts',
        testIdPrefix: 'home-track-charts',
        tracks,
        context,
        onPlay,
        onActions,
        onOpenAlbum: vi.fn(),
        onOpenArtist: vi.fn(),
      }),
      'home-shelf-charts',
    );
    const keyExtractor = rail.props.keyExtractor as (track: Track, index: number) => string;
    const second = renderRow<Track>(rail, 1);

    expect(rail.type).toBe('FlatList');
    expect(rail.props.horizontal).toBe(true);
    // Duplicate tracks stay distinct rows.
    expect(keyExtractor(tracks[0], 0)).not.toBe(keyExtractor(tracks[1], 1));
    expect(second.props.testID).toBe('home-track-charts-a-1-1');
    expect(second.props.occurrence).toEqual({ queueContext: context, originalContextOrder: 1 });
    (second.props.onPress as () => void)();
    (second.props.onLongPress as () => void)();
    expect(onPlay).toHaveBeenCalledWith(1);
    expect(onActions).toHaveBeenCalledWith(tracks[1]);
  });
});

describe('HomeShelfRail', () => {
  it('hands the pressed shelf to the caller with a stable card testID', () => {
    const shelves = [{ key: 'Daily Focus', title: 'Daily Focus', tracks: [] }] as unknown as HomeShelf[];
    const onPress = vi.fn();
    const rail = byTestId(
      HomeShelfRail({
        id: 'mixes',
        testIdPrefix: 'home-shelf-card-mixes',
        shelves,
        action: 'open',
        onPress,
      }),
      'home-shelf-mixes',
    );
    const card = renderRow<HomeShelf>(rail, 0);

    expect(card.props.testID).toBe('home-shelf-card-mixes-daily-focus');
    expect(card.props.action).toBe('open');
    (card.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledWith(shelves[0]);
  });
});
