import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SseHttpError } from '../../api/sseStream';
import { getConnectivitySnapshot, subscribeConnectivity } from '../../connectivity/store';
import { openPlaylistEventsStream } from '../../data/playlistEventsStream';
import { queryKeys } from '../../data/queryKeys';
import { wave2Strings } from '../../localization/wave2Strings';
import { colors, radii, spacing } from '../../theme';
import { ActionButton, AppText } from '../ui';

export interface PlaylistLiveSyncBannerProps {
  playlistId: number;
  scope: string;
  currentRevision: number;
  focused: boolean;
  isCollaborative: boolean;
  onExit: () => void;
}

/**
 * Live collaborative playlist SSE subscriber (`GET /api/playlists/{id}/events`).
 * Refetches when a newer revision arrives, and surfaces loud access revocation /
 * deletion notices so editors are never stranded on stale playlist state.
 */
export function PlaylistLiveSyncBanner({
  playlistId,
  scope,
  currentRevision,
  focused,
  isCollaborative,
  onExit,
}: PlaylistLiveSyncBannerProps) {
  const queryClient = useQueryClient();
  const connectivity = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivitySnapshot,
    getConnectivitySnapshot,
  ).status;
  const revisionRef = useRef(currentRevision);
  const [terminalEvent, setTerminalEvent] = useState<'revoked' | 'deleted' | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);

  useEffect(() => {
    revisionRef.current = currentRevision;
  }, [currentRevision]);

  useEffect(() => {
    if (!isCollaborative || !focused || connectivity === 'offline' || terminalEvent !== null) {
      return undefined;
    }
    let disposed = false;
    let closeStream: (() => void) | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const enterTerminal = (kind: 'revoked' | 'deleted') => {
      closeStream?.();
      closeStream = null;
      setStreamError(null);
      setTerminalEvent(kind);
      void queryClient.invalidateQueries({ queryKey: queryKeys.playlists.owned(scope) });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.playlists.detail(scope, playlistId),
      });
      AccessibilityInfo.announceForAccessibility(
        kind === 'deleted'
          ? wave2Strings.collab.deletedNotice
          : wave2Strings.collab.revokedNotice,
      );
    };

    const connect = () => {
      if (disposed) return;
      void openPlaylistEventsStream(playlistId, {
        onMessage: (evt) => {
          if (disposed) return;
          setStreamError(null);
          if (evt.event === 'deleted' || evt.event === 'revoked') {
            enterTerminal(evt.event);
            return;
          }
          if (
            (evt.event === 'updated' || evt.event === 'snapshot')
            && evt.revision > revisionRef.current
          ) {
            revisionRef.current = evt.revision;
            void queryClient.invalidateQueries({
              queryKey: queryKeys.playlists.detail(scope, playlistId),
            });
          }
        },
        onRenew: () => {
          if (!disposed) connect();
        },
        onClosed: (error) => {
          if (disposed) return;
          if (error instanceof SseHttpError) {
            if (error.status === 403) {
              enterTerminal('revoked');
              return;
            }
            if (error.status === 404) {
              enterTerminal('deleted');
              return;
            }
            if (error.status === 401) {
              console.error(
                `[LoggeRythm] Playlist ${playlistId} live sync unauthorized (HTTP 401):`,
                error,
              );
              setStreamError(`${wave2Strings.collab.streamError} (${error.message})`);
              return;
            }
          }
          setStreamError(`${wave2Strings.collab.streamError} (${error.message})`);
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
            setStreamError(`${wave2Strings.collab.streamError} (${detail})`);
          }
        });
    };

    connect();
    return () => {
      disposed = true;
      closeStream?.();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    };
  }, [connectivity, focused, isCollaborative, playlistId, queryClient, scope, terminalEvent]);

  if (terminalEvent !== null) {
    return (
      <View testID="playlist-live-terminal" accessibilityRole="alert" style={styles.dangerBox}>
        <AppText variant="callout" color="danger">
          {terminalEvent === 'deleted'
            ? wave2Strings.collab.deletedNotice
            : wave2Strings.collab.revokedNotice}
        </AppText>
        <ActionButton
          testID="playlist-live-exit"
          variant="secondary"
          label={wave2Strings.party2.kioskClose}
          onPress={onExit}
        />
      </View>
    );
  }

  if (streamError !== null) {
    return (
      <View testID="playlist-live-error" accessibilityRole="alert" style={styles.warningBox}>
        <AppText variant="caption" color="warning">
          {streamError}
        </AppText>
      </View>
    );
  }

  if (!isCollaborative || connectivity === 'offline') return null;

  return (
    <View testID="playlist-live-badge" style={styles.liveRow}>
      <View style={styles.liveDot} />
      <AppText variant="micro" color="accent">
        {wave2Strings.collab.liveBadge}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  liveRow: {
    alignSelf: 'flex-start',
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
  dangerBox: {
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSubtle,
    gap: spacing.xs,
  },
  warningBox: {
    padding: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.fill,
  },
});
