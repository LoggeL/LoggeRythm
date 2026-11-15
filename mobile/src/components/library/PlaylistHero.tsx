import React from 'react';
import { StyleSheet, View } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, layout, radii, spacing } from '../../theme';
import AppIcon, { type AppIconName } from '../AppIcon';
import type { OfflinePlaylistControlState } from '../offline/OfflinePlaylistControl';
import { AppText, Artwork, IconButton, PlayButton } from '../ui';

/** "48 Min." / "1 Std. 12 Min." for a positive whole duration, null when nothing is known. */
export function playlistDurationLabel(totalSeconds: number): string | null {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
  const totalMinutes = Math.max(1, Math.round(totalSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0
    ? libraryStrings.playlist.durationMinutes(minutes)
    : libraryStrings.playlist.durationHours(hours, minutes);
}

export interface PlaylistHeroDownload {
  kind: OfflinePlaylistControlState['kind'];
  /** Label of the quick action, e.g. "Download" or "Open download status". */
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}

const downloadLook: Record<
  OfflinePlaylistControlState['kind'],
  { icon: AppIconName; color: string | undefined }
> = {
  unavailable: { icon: 'cloud-off-outline', color: colors.textMuted },
  idle: { icon: 'download-circle-outline', color: undefined },
  downloading: { icon: 'download-circle-outline', color: undefined },
  removing: { icon: 'download-circle-outline', color: undefined },
  partial: { icon: 'alert-circle-outline', color: colors.warning },
  error: { icon: 'alert-circle-outline', color: colors.danger },
  downloaded: { icon: 'check-circle', color: colors.success },
};

export interface PlaylistHeroProps {
  title: string;
  /** Absolute cover URL; null shows the placeholder. */
  coverUrl: string | null;
  /** The liked-tracks collection gets its accent heart tile instead of a cover. */
  liked: boolean;
  ownerName: string | null;
  trackCount: number;
  /** Sum of the listed tracks' durations in seconds. */
  durationSeconds: number;
  /** Owner-only visibility badge; null hides it. */
  visibility: 'public' | 'private' | null;
  description: string | null;
  /** Shows the play + shuffle controls (there is something playable). */
  playable: boolean;
  onPlay: () => void;
  onShuffle: () => void;
  download: PlaylistHeroDownload | null;
  /** Opens the overflow sheet; undefined hides the button. */
  onOpenActions?: () => void;
}

/**
 * The top of the playlist screen: one large cover, the title, a single
 * metadata line and one action row that starts with the PlayButton.
 */
export function PlaylistHero({
  title,
  coverUrl,
  liked,
  ownerName,
  trackCount,
  durationSeconds,
  visibility,
  description,
  playable,
  onPlay,
  onShuffle,
  download,
  onOpenActions,
}: PlaylistHeroProps) {
  const duration = playlistDurationLabel(durationSeconds);
  return (
    <View style={styles.hero}>
      {liked ? (
        <View style={styles.likedCover}>
          <AppIcon name="heart" color={colors.onAccent} size={layout.artwork.lg} />
        </View>
      ) : (
        <Artwork uri={coverUrl} size={layout.artwork.hero} icon="playlist-music" />
      )}

      <View style={styles.identity}>
        <AppText
          testID="playlist-title"
          accessibilityRole="header"
          variant="hero"
          align="center"
          numberOfLines={3}
        >
          {title}
        </AppText>
        <View style={styles.meta}>
          {ownerName ? (
            <AppText variant="callout" color="secondary" numberOfLines={1} style={styles.owner}>
              {libraryStrings.playlist.byOwner(ownerName)}
            </AppText>
          ) : null}
          <AppText testID="playlist-track-count" variant="callout" color="secondary">
            {libraryStrings.common.tracks(trackCount)}
          </AppText>
          {duration === null ? null : (
            <AppText testID="playlist-duration" variant="callout" color="secondary">
              {duration}
            </AppText>
          )}
          {visibility === null ? null : (
            <View testID="playlist-visibility-badge" style={styles.badge}>
              <AppIcon
                name={visibility === 'public' ? 'earth' : 'lock-outline'}
                color={colors.textSecondary}
                size={14}
              />
              <AppText variant="micro" color="secondary">
                {visibility === 'public'
                  ? libraryStrings.playlist.public
                  : libraryStrings.playlist.private}
              </AppText>
            </View>
          )}
        </View>
        {description ? (
          <AppText
            testID="playlist-description"
            variant="callout"
            color="muted"
            align="center"
            numberOfLines={3}
          >
            {description}
          </AppText>
        ) : null}
      </View>

      <View testID="playlist-action-row" style={styles.actions}>
        {playable ? (
          <>
            <PlayButton
              testID="playlist-play-all"
              size="lg"
              accessibilityLabel={libraryStrings.playlist.playAll}
              onPress={onPlay}
            />
            <IconButton
              testID="playlist-shuffle"
              icon="shuffle-variant"
              variant="tonal"
              accessibilityLabel={libraryStrings.playlist.shuffle}
              onPress={onShuffle}
            />
          </>
        ) : null}
        {download === null ? null : (
          <IconButton
            testID="playlist-download"
            icon={downloadLook[download.kind].icon}
            color={downloadLook[download.kind].color}
            variant="tonal"
            busy={download.kind === 'downloading' || download.kind === 'removing'}
            disabled={download.disabled}
            accessibilityLabel={download.accessibilityLabel}
            onPress={download.onPress}
          />
        )}
        {onOpenActions === undefined ? null : (
          <IconButton
            testID="playlist-actions"
            icon="dots-horizontal"
            variant="tonal"
            accessibilityLabel={libraryStrings.playlist.openMenu}
            onPress={onOpenActions}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.lg },
  likedCover: {
    width: layout.artwork.hero,
    height: layout.artwork.hero,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  identity: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.xs },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.sm,
    rowGap: spacing.xxs,
  },
  owner: { flexShrink: 1 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs / 2,
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
  },
  actions: {
    minHeight: layout.rowHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
});
