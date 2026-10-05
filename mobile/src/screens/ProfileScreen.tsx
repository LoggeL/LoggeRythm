import React, { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MeUpdateRequest } from '../api/endpoints';
import { resolveServerUrl } from '../api/url';
import { useAuth } from '../auth/AuthContext';
import {
  ListeningStatsPanel,
  ProfileEditForm,
  ProfileIdentityCard,
  SleepTimerPanel,
} from '../components/profile/ProfileSections';
import LanguageSelector from '../components/profile/LanguageSelector';
import AndroidUpdateCard from '../components/profile/AndroidUpdateCard';
import { getCurrentApiBase } from '../config';
import { musicCacheScope, musicQueries, musicRepository, queryKeys } from '../data';
import { strings } from '../localization';
import { colors, metrics, radii, spacing, typography } from '../theme';
import { ScreenHeader } from '../components/ui';
import { profileDeleteFailureMessage } from './profileFeedback';
import { persistProfileUpdate } from './profileUpdate';

function errorOf(value: unknown): Error | null {
  if (value === null || value === undefined) return null;
  return value instanceof Error ? value : new Error(String(value));
}

function safeAvatarUri(value: string | null, apiBase: string): string | null {
  if (!value) return null;
  try {
    return resolveServerUrl(value, apiBase);
  } catch (error) {
    throw new Error('Profile avatar URL is invalid for the selected server', { cause: error });
  }
}

export default function ProfileScreen() {
  const { user, refreshUser, deleteAccount } = useAuth();
  if (user === null) throw new Error('ProfileScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const apiBase = getCurrentApiBase();
  const scope = musicCacheScope(apiBase, user.id);
  const stats = useQuery(musicQueries.stats(scope));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const refreshing = stats.isFetching && !stats.isPending;

  const saveProfile = async (patch: MeUpdateRequest) => {
    await persistProfileUpdate(patch, user.id, {
      updateMe: musicRepository.updateMe,
      refreshUser,
      invalidatePublicProfile: (userId) =>
        queryClient.invalidateQueries({ queryKey: queryKeys.profile.public(userId) }),
    });
  };

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
    } catch (error) {
      setDeleteError(profileDeleteFailureMessage(error, strings.profile));
      setDeleting(false);
    }
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteError(null);
    setConfirmingDelete(false);
  };

  return (
    <View testID="profile-screen" style={styles.container}>
      <ScrollView
        testID="profile-scroll"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void stats.refetch()}
            accessibilityLabel={strings.profile.refreshStats}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surfaceElevated}
          />
        }
        contentContainerStyle={styles.content}
      >
        <ScreenHeader testID="profile-hero" title={strings.profile.title} subtitle={strings.profile.subtitle} style={styles.hero} />

        <ProfileIdentityCard
          user={user}
          avatarUri={safeAvatarUri(user.avatar_url, apiBase)}
          serverOrigin={apiBase}
        />
        <SleepTimerPanel />
        <ProfileEditForm
          key={`${user.display_name ?? ''}:${user.email}`}
          user={user}
          onSave={saveProfile}
        />
        <ListeningStatsPanel
          data={stats.data}
          pending={stats.isPending}
          fetching={stats.isFetching}
          fetchStatus={stats.fetchStatus}
          stale={stats.isStale}
          error={errorOf(stats.error)}
          onRefresh={() => void stats.refetch()}
        />
        <LanguageSelector />
        <AndroidUpdateCard />

        <View testID="profile-danger" style={styles.dangerCard}>
          <Text accessibilityRole="header" style={styles.dangerTitle}>{strings.profile.dangerTitle}</Text>
          <Text style={styles.dangerBody}>{strings.profile.dangerBody}</Text>
          <Pressable
            testID="profile-delete"
            accessibilityRole="button"
            accessibilityLabel={strings.profile.deleteAccount}
            onPress={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
            style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
          >
            <Text style={styles.deleteButtonText}>{strings.profile.deleteAccount}</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal
        visible={confirmingDelete}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeDelete}
      >
        <View style={styles.modalBackdrop}>
          <View
            testID="profile-delete-confirmation"
            accessibilityViewIsModal
            style={styles.modalCard}
          >
            <Text accessibilityRole="header" style={styles.modalTitle}>{strings.profile.deleteTitle}</Text>
            <Text style={styles.modalWarning}>{strings.profile.deleteWarning}</Text>
            {deleteError ? (
              <Text
                testID="profile-delete-error"
                accessibilityRole="alert"
                accessibilityLiveRegion="assertive"
                style={styles.deleteError}
              >
                {deleteError}
              </Text>
            ) : null}
            <Pressable
              testID="profile-delete-confirm"
              accessibilityRole="button"
              accessibilityState={{ disabled: deleting, busy: deleting }}
              disabled={deleting}
              onPress={() => void confirmDelete()}
              style={({ pressed }) => [styles.deleteConfirmButton, pressed && styles.pressed, deleting && styles.disabled]}
            >
              {deleting ? <ActivityIndicator color={colors.onAccent} /> : null}
              <Text style={styles.deleteConfirmText}>
                {deleting ? strings.profile.deleting : strings.profile.deleteConfirm}
              </Text>
            </Pressable>
            <Pressable
              testID="profile-delete-cancel"
              accessibilityRole="button"
              accessibilityState={{ disabled: deleting }}
              disabled={deleting}
              onPress={closeDelete}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed, deleting && styles.disabled]}
            >
              <Text style={styles.cancelButtonText}>{strings.profile.deleteCancel}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: 140 },
  hero: { paddingVertical: spacing.xs },
  dangerCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.dangerSubtle },
  dangerTitle: { ...typography.section, color: colors.textPrimary },
  dangerBody: { ...typography.body, color: colors.textSecondary },
  deleteButton: { minHeight: metrics.minimumTouchTarget, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  deleteButtonText: { ...typography.label, color: colors.danger },
  modalBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0, 0, 0, 0.76)' },
  modalCard: { width: '100%', maxWidth: 430, gap: spacing.md, padding: spacing.xl, borderRadius: radii.xl, backgroundColor: colors.surfaceElevated },
  modalTitle: { ...typography.section, color: colors.textPrimary },
  modalWarning: { color: colors.textSecondary, fontSize: 14, lineHeight: 21 },
  deleteError: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  deleteConfirmButton: { minHeight: metrics.minimumTouchTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.danger },
  deleteConfirmText: { ...typography.label, color: colors.onAccent },
  cancelButton: { minHeight: metrics.minimumTouchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  cancelButtonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.48 },
});
