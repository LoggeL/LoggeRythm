import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FriendActivityItem, Track } from '../../api/types';
import { resolveServerUrl } from '../../api/url';
import { getCurrentApiBase } from '../../config';
import { getConnectivitySnapshot, subscribeConnectivity } from '../../connectivity/store';
import { musicQueries, queryKeys } from '../../data';
import { useHaptics } from '../../hooks/useHaptics';
import { wave2Strings } from '../../localization/wave2Strings';
import { playTrackRow } from '../../player/controller';
import { reportPlayerError } from '../../player/errors';
import { openSocialActivityStream } from '../../social/socialActivityStream';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { ActionButton, AppText, Artwork, SectionHeader } from '../ui';

export interface FriendsListeningViewProps {
  items: readonly FriendActivityItem[];
  apiBase: string;
  streamError: string | null;
  onPlayTrack: (track: Track) => void;
  onJoinJam: (code: string) => void;
}

export function FriendsListeningView({
  items,
  apiBase,
  streamError,
  onPlayTrack,
  onJoinJam,
}: FriendsListeningViewProps) {
  if (items.length === 0 && streamError === null) return null;

  return (
    <View testID="friends-listening-section" style={styles.section}>
      <View style={styles.headerRow}>
        <SectionHeader title={wave2Strings.friends.title} padded={false} />
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <AppText variant="micro" color="accent">
            {wave2Strings.friends.liveBadge}
          </AppText>
        </View>
      </View>

      {streamError !== null ? (
        <AppText testID="friends-stream-error" accessibilityRole="alert" variant="caption" color="danger">
          {streamError}
        </AppText>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {items.map((item) => {
          const avatarUri = item.avatar_url ? resolveServerUrl(item.avatar_url, apiBase) : null;
          const displayName = item.display_name?.trim() || `#${item.user_id}`;
          return (
            <View
              key={item.user_id}
              testID={`friend-activity-${item.user_id}`}
              style={styles.card}
            >
              <View style={styles.friendHeader}>
                <Artwork uri={avatarUri} size={32} shape="round" icon="account" />
                <View style={styles.flexOne}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {displayName}
                  </AppText>
                  <AppText variant="micro" color={item.is_playing ? 'accent' : 'secondary'} numberOfLines={1}>
                    {item.is_playing
                      ? wave2Strings.friends.playingNow
                      : wave2Strings.friends.recentTrack}
                    {item.device_name ? ` · ${item.device_name}` : ''}
                  </AppText>
                </View>
              </View>

              {item.track !== null ? (
                <Pressable
                  testID={`friend-play-${item.user_id}`}
                  accessibilityRole="button"
                  focusable
                  onPress={() => onPlayTrack(item.track!)}
                  style={({ pressed }) => [styles.trackRow, pressed ? styles.pressed : null]}
                >
                  <Artwork uri={item.track.cover} size={44} icon="music-note" />
                  <View style={styles.flexOne}>
                    <AppText variant="label" numberOfLines={1}>
                      {item.track.title}
                    </AppText>
                    <AppText variant="caption" color="secondary" numberOfLines={1}>
                      {item.track.artist}
                    </AppText>
                  </View>
                  <AppIcon name="play-circle-outline" size={22} color={colors.accent} />
                </Pressable>
              ) : null}

              {item.party_code !== null ? (
                <ActionButton
                  testID={`friend-join-jam-${item.party_code}`}
                  icon="account-group-outline"
                  label={wave2Strings.friends.joinJam}
                  variant="primary"
                  onPress={() => onJoinJam(item.party_code!)}
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export interface FriendsListeningSectionProps {
  scope: string;
  onOpenParty?: (code: string) => void;
}

/** Live Friends Listening Now shelf on Home powered by GET /api/social/activity + SSE. */
export function FriendsListeningSection({ scope, onOpenParty }: FriendsListeningSectionProps) {
  const queryClient = useQueryClient();
  const haptics = useHaptics();
  const connectivity = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot,
  ).status;
  const apiBase = getCurrentApiBase();
  const [streamError, setStreamError] = useState<string | null>(null);

  const query = useQuery({
    ...musicQueries.socialActivity(scope),
    enabled: connectivity !== 'offline',
  });

  useEffect(() => {
    if (connectivity === 'offline') return undefined;
    let disposed = false;
    let closeStream: (() => void) | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      void openSocialActivityStream({
        onMessage: (snapshot) => {
          if (disposed) return;
          setStreamError(null);
          queryClient.setQueryData(queryKeys.social.activity(scope), snapshot);
        },
        onRenew: () => {
          if (!disposed) connect();
        },
        onClosed: (error) => {
          if (disposed) return;
          setStreamError(`${wave2Strings.friends.streamError} (${error.message})`);
          reconnectTimer = setTimeout(connect, 5_000);
        },
      })
        .then((close) => {
          if (disposed) close();
          else closeStream = close;
        })
        .catch((error: unknown) => {
          if (!disposed) {
            const detail = error instanceof Error ? error.message : String(error);
            setStreamError(`${wave2Strings.friends.streamError} (${detail})`);
          }
        });
    };

    connect();
    return () => {
      disposed = true;
      closeStream?.();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    };
  }, [connectivity, queryClient, scope]);

  const items = query.data?.items ?? [];

  return (
    <FriendsListeningView
      items={items}
      apiBase={apiBase}
      streamError={streamError}
      onPlayTrack={(track) => {
        haptics.trigger('tap');
        void playTrackRow([track], 0, {
          context: { type: 'collection', id: 'friends-live', label: wave2Strings.friends.title },
        }).catch((cause: unknown) => {
          reportPlayerError(wave2Strings.friends.title, cause);
        });
      }}
      onJoinJam={(code) => {
        haptics.trigger('tap');
        onOpenParty?.(code);
      }}
    />
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    paddingHorizontal: layout.pagePadding,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSubtle,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  rail: {
    gap: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  card: {
    width: 248,
    padding: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.hairline,
    gap: spacing.sm,
  },
  friendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  trackRow: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: opacity.pressed,
  },
});
