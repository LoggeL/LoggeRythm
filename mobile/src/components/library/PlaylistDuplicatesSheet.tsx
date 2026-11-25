import React, { useState } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlaylistDuplicatesResponse } from '../../api/types';
import { musicQueries, musicRepository, queryKeys } from '../../data';
import { wave2Strings } from '../../localization/wave2Strings';
import { colors, radii, spacing } from '../../theme';
import {
  ActionButton,
  AppText,
  BottomSheet,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
} from '../ui';

export interface PlaylistDuplicatesViewProps {
  data: PlaylistDuplicatesResponse | undefined;
  isPending: boolean;
  isError: boolean;
  deduplicating: boolean;
  dedupeError: string | null;
  removedCount: number | null;
  onRetry: () => void;
  onDeduplicate: () => void;
  onClose: () => void;
}

export function PlaylistDuplicatesView({
  data,
  isPending,
  isError,
  deduplicating,
  dedupeError,
  removedCount,
  onRetry,
  onDeduplicate,
  onClose,
}: PlaylistDuplicatesViewProps) {
  const groups = data?.groups ?? [];
  const totalDuplicates = data?.total_duplicates ?? 0;

  return (
    <View testID="playlist-duplicates-content" style={styles.container}>
      <View style={styles.header}>
        <AppText variant="section" style={styles.title}>
          {wave2Strings.playlistTools.duplicatesTitle}
        </AppText>
        <IconButton
          testID="playlist-duplicates-close"
          icon="close"
          size="sm"
          accessibilityLabel={wave2Strings.party2.kioskClose}
          onPress={onClose}
        />
      </View>

      {removedCount !== null ? (
        <AppText testID="playlist-duplicates-done" variant="callout" color="success">
          {wave2Strings.playlistTools.deduplicated(removedCount)}
        </AppText>
      ) : null}

      {dedupeError !== null ? (
        <AppText testID="playlist-duplicates-dedupe-error" accessibilityRole="alert" variant="callout" color="danger">
          {dedupeError}
        </AppText>
      ) : null}

      {isPending && data === undefined ? (
        <View testID="playlist-duplicates-loading" style={styles.skeletons}>
          <Skeleton width="70%" height={20} />
          <Skeleton width="100%" height={52} />
          <Skeleton width="100%" height={52} />
        </View>
      ) : isError && data === undefined ? (
        <ErrorState
          testID="playlist-duplicates-error"
          retryTestID="playlist-duplicates-retry"
          message={wave2Strings.playlistTools.duplicatesFailed}
          onRetry={onRetry}
        />
      ) : totalDuplicates === 0 || groups.length === 0 ? (
        <EmptyState
          testID="playlist-duplicates-empty"
          icon="check-circle-outline"
          title={wave2Strings.playlistTools.duplicatesEmpty}
        />
      ) : (
        <>
          <AppText testID="playlist-duplicates-summary" variant="callout" color="secondary">
            {wave2Strings.playlistTools.duplicatesFound(totalDuplicates)}
          </AppText>
          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {groups.map((group) => (
              <View
                key={group.keep_entry_id}
                testID={`playlist-dup-group-${group.keep_entry_id}`}
                style={styles.groupRow}
              >
                <View style={styles.groupCopy}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {group.title}
                  </AppText>
                  <AppText variant="caption" color="secondary" numberOfLines={1}>
                    {group.artist}
                  </AppText>
                </View>
                <AppText variant="micro" color="accent" style={styles.copyBadge}>
                  {wave2Strings.playlistTools.duplicatesGroupCopies(group.duplicate_entry_ids.length)}
                </AppText>
              </View>
            ))}
          </ScrollView>
          <ActionButton
            testID="playlist-duplicates-confirm"
            icon="broom"
            variant="primary"
            label={
              deduplicating
                ? wave2Strings.playlistTools.deduplicating
                : wave2Strings.playlistTools.deduplicateAction(totalDuplicates)
            }
            busy={deduplicating}
            disabled={deduplicating}
            fullWidth
            onPress={onDeduplicate}
          />
        </>
      )}
    </View>
  );
}

export interface PlaylistDuplicatesSheetProps {
  visible: boolean;
  playlistId: number;
  scope: string;
  onClose: () => void;
}

/** Preview & one-tap deduplication sheet backed by GET /duplicates + POST /deduplicate. */
export function PlaylistDuplicatesSheet({
  visible,
  playlistId,
  scope,
  onClose,
}: PlaylistDuplicatesSheetProps) {
  const queryClient = useQueryClient();
  const [removedCount, setRemovedCount] = useState<number | null>(null);
  const [dedupeError, setDedupeError] = useState<string | null>(null);

  const query = useQuery({
    ...musicQueries.playlistDuplicates(scope, playlistId),
    enabled: visible,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!musicRepository.deduplicatePlaylist) {
        throw new Error('Playlist deduplicate endpoint unavailable');
      }
      return musicRepository.deduplicatePlaylist(playlistId);
    },
    onMutate: () => {
      setDedupeError(null);
      setRemovedCount(null);
    },
    onSuccess: (result) => {
      setRemovedCount(result.removed_count);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.playlists.detail(scope, playlistId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.playlists.duplicates(scope, playlistId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.playlists.owned(scope),
      });
      AccessibilityInfo.announceForAccessibility(
        wave2Strings.playlistTools.deduplicated(result.removed_count),
      );
    },
    onError: (cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setDedupeError(`${wave2Strings.playlistTools.duplicatesFailed} (${detail})`);
    },
  });

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel={wave2Strings.party2.kioskClose}
      testID="playlist-duplicates-sheet"
    >
      <PlaylistDuplicatesView
        data={query.data}
        isPending={query.isPending}
        isError={query.isError}
        deduplicating={mutation.isPending}
        dedupeError={dedupeError}
        removedCount={removedCount}
        onRetry={() => void query.refetch()}
        onDeduplicate={() => mutation.mutate()}
        onClose={onClose}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, paddingBottom: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1 },
  skeletons: { gap: spacing.sm },
  list: { maxHeight: 280 },
  listContent: { gap: spacing.xs },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  groupCopy: { flex: 1, minWidth: 0, gap: 2 },
  copyBadge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSubtle,
    overflow: 'hidden',
  },
});
