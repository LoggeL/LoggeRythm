import { describe, expect, it, vi } from 'vitest';
import { libraryStrings } from '../../screens/libraryStrings';
import { byTestId, byType, queryByTestId, textContent } from '../../test/render';
import { PlaylistHero, playlistDurationLabel, type PlaylistHeroProps } from './PlaylistHero';

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Image: 'Image',
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../AppIcon', () => ({ default: 'AppIcon' }));

function render(overrides: Partial<PlaylistHeroProps> = {}) {
  const props: PlaylistHeroProps = {
    title: 'Night Drive',
    coverUrl: 'https://music.test/covers/7.jpg',
    liked: false,
    ownerName: 'Logge',
    trackCount: 12,
    durationSeconds: 2_880,
    visibility: null,
    description: 'Late hours',
    playable: true,
    onPlay: vi.fn(),
    onShuffle: vi.fn(),
    download: null,
    onOpenActions: vi.fn(),
    ...overrides,
  };
  return { props, tree: PlaylistHero(props) };
}

describe('playlistDurationLabel', () => {
  it('formats minutes and hours and reports nothing for an unknown duration', () => {
    expect(playlistDurationLabel(2_880)).toBe(libraryStrings.playlist.durationMinutes(48));
    expect(playlistDurationLabel(20)).toBe(libraryStrings.playlist.durationMinutes(1));
    expect(playlistDurationLabel(4_320)).toBe(libraryStrings.playlist.durationHours(1, 12));
    expect(playlistDurationLabel(0)).toBeNull();
    expect(playlistDurationLabel(Number.NaN)).toBeNull();
  });
});

describe('PlaylistHero', () => {
  it('shows the cover, a truncating header title and one metadata line', () => {
    const { tree } = render();
    const title = byTestId(tree, 'playlist-title');

    expect(title.props).toMatchObject({ accessibilityRole: 'header', numberOfLines: 3 });
    expect(byType(tree, 'Image')[0].props.source).toEqual({ uri: 'https://music.test/covers/7.jpg' });
    expect(textContent(tree)).toEqual([
      'Night Drive',
      libraryStrings.playlist.byOwner('Logge'),
      libraryStrings.common.tracks(12),
      libraryStrings.playlist.durationMinutes(48),
      'Late hours',
    ]);
    expect(queryByTestId(tree, 'playlist-visibility-badge')).toBeNull();
  });

  it('leaves out what is unknown instead of inventing it', () => {
    const { tree } = render({
      coverUrl: null,
      ownerName: null,
      durationSeconds: 0,
      description: null,
      trackCount: 0,
    });

    expect(byType(tree, 'Image')).toHaveLength(0);
    expect(textContent(tree)).toEqual(['Night Drive', libraryStrings.common.tracks(0)]);
    expect(queryByTestId(tree, 'playlist-duration')).toBeNull();
    expect(queryByTestId(tree, 'playlist-description')).toBeNull();
  });

  it('badges the owner visibility', () => {
    expect(textContent(render({ visibility: 'public' }).tree))
      .toContain(libraryStrings.playlist.public);
    expect(textContent(render({ visibility: 'private' }).tree))
      .toContain(libraryStrings.playlist.private);
  });

  it('starts the action row with the play button, then shuffle and the overflow', () => {
    const { props, tree } = render();
    const row = byTestId(tree, 'playlist-action-row');
    const buttons = byType(row, 'Pressable');

    expect(buttons.map((button) => button.props.testID)).toEqual([
      'playlist-play-all',
      'playlist-shuffle',
      'playlist-actions',
    ]);
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual([
      libraryStrings.playlist.playAll,
      libraryStrings.playlist.shuffle,
      libraryStrings.playlist.openMenu,
    ]);
    buttons.forEach((button) => (button.props.onPress as () => void)());
    expect(props.onPlay).toHaveBeenCalledOnce();
    expect(props.onShuffle).toHaveBeenCalledOnce();
    expect(props.onOpenActions).toHaveBeenCalledOnce();
  });

  it('hides playback for an unplayable collection and the overflow without a menu', () => {
    const { tree } = render({ playable: false, onOpenActions: undefined });

    expect(queryByTestId(tree, 'playlist-play-all')).toBeNull();
    expect(queryByTestId(tree, 'playlist-shuffle')).toBeNull();
    expect(queryByTestId(tree, 'playlist-actions')).toBeNull();
  });

  it('exposes the download quick action with its state', () => {
    const onPress = vi.fn();
    const idle = render({
      download: {
        kind: 'idle',
        accessibilityLabel: libraryStrings.playlist.downloadAction,
        disabled: false,
        onPress,
      },
    }).tree;
    const button = byTestId(idle, 'playlist-download');
    expect(button.props).toMatchObject({
      accessibilityLabel: libraryStrings.playlist.downloadAction,
      disabled: false,
    });
    (button.props.onPress as () => void)();
    expect(onPress).toHaveBeenCalledOnce();

    const downloading = render({
      download: {
        kind: 'downloading',
        accessibilityLabel: libraryStrings.playlist.downloadStatus,
        disabled: false,
        onPress,
      },
    }).tree;
    expect(byTestId(downloading, 'playlist-download').props).toMatchObject({
      disabled: true,
      accessibilityState: { disabled: true, busy: true },
    });
  });

  it('gives the liked collection its own tile instead of a remote cover', () => {
    const { tree } = render({ liked: true, coverUrl: null });

    expect(byType(tree, 'Image')).toHaveLength(0);
    expect(byType(tree, 'AppIcon').some((icon) => icon.props.name === 'heart')).toBe(true);
  });

  it('shows collaborative badge and tappable collaborator avatar stack with overflow indicator', () => {
    const onOpenCollaborators = vi.fn();
    const members = [1, 2, 3, 4, 5].map((id) => ({
      key: `member-${id}`,
      name: `User ${id}`,
      avatarUrl: null,
    }));
    const { tree } = render({
      collaborative: true,
      collaborators: {
        owner: { key: 'owner-1', name: 'Logge', avatarUrl: 'https://music.test/avatar.jpg' },
        members,
        onPress: onOpenCollaborators,
      },
    });

    expect(byTestId(tree, 'playlist-collaborative-badge')).toBeDefined();
    expect(textContent(tree)).toContain(libraryStrings.playlist.collaborativeBadge);
    expect(textContent(tree)).toContain(libraryStrings.playlist.collaboratorCount(5));
    expect(textContent(tree)).toContain('+1');

    const trigger = byTestId(tree, 'playlist-collaborators-trigger');
    expect(trigger.props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: libraryStrings.playlist.openCollaborators,
    });
    (trigger.props.onPress as () => void)();
    expect(onOpenCollaborators).toHaveBeenCalledOnce();

    const nonInteractive = render({
      collaborative: true,
      collaborators: {
        owner: { key: 'owner-1', name: 'Logge', avatarUrl: null },
        members: [],
      },
    }).tree;
    expect(queryByTestId(nonInteractive, 'playlist-collaborators-trigger')).toBeNull();
    expect(byTestId(nonInteractive, 'playlist-collaborators-summary')).toBeDefined();
  });
});
