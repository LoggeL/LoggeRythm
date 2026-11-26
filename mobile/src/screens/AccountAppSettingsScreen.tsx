import React, { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import type { MeUpdateRequest } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import AndroidUpdateCard from '../components/profile/AndroidUpdateCard';
import LanguageSelector from '../components/profile/LanguageSelector';
import { ProfileSettingsShell } from '../components/profile/ProfileChrome';
import { ProfileGroup } from '../components/profile/ProfileGroup';
import {
  ProfileAccountDetailsCard,
  ProfileEditForm,
} from '../components/profile/ProfileSections';
import { ActionButton, AppText, BottomSheet } from '../components/ui';
import { getCurrentApiBase } from '../config';
import { musicRepository, queryKeys } from '../data';
import { strings } from '../localization';
import { spacing } from '../theme';
import { tvFocusRegistry, useTvEnvironment } from '../tv';
import { profileDeleteFailureMessage } from './profileFeedback';
import { persistProfileUpdate } from './profileUpdate';

/**
 * Thematic Account & App settings screen: houses account details editing,
 * device language selection, Android app version & updates, and the
 * destructive account-deletion confirmation flow.
 */
export default function AccountAppSettingsScreen() {
  const { user, refreshUser, deleteAccount } = useAuth();
  if (user === null) throw new Error('AccountAppSettingsScreen requires an authenticated user');

  const queryClient = useQueryClient();
  const apiBase = getCurrentApiBase();
  // Hook order of these 3 useState cells is pinned by ProfileSettingsScreens.test.tsx.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const tv = useTvEnvironment();

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

  const openDelete = () => {
    if (tv.isTv) tvFocusRegistry.pushCheckpoint('profile-delete');
    setDeleteError(null);
    setConfirmingDelete(true);
  };

  const closeDelete = () => {
    if (deleting) return;
    setDeleteError(null);
    setConfirmingDelete(false);
    if (tv.isTv) tvFocusRegistry.popAndRestore();
  };

  const accountDetailsCard = (
    <ProfileAccountDetailsCard user={user} serverOrigin={apiBase} />
  );
  const editForm = (
    <ProfileEditForm
      key={`${user.display_name ?? ''}:${user.email}`}
      user={user}
      onSave={saveProfile}
    />
  );
  const languagePanel = <LanguageSelector />;
  const updateCard = <AndroidUpdateCard />;
  const dangerGroup = (
    <ProfileGroup
      testID="profile-danger"
      tone="danger"
      icon="delete-outline"
      title={strings.profile.dangerTitle}
    >
      <ActionButton
        testID="profile-delete"
        variant="danger"
        label={strings.profile.deleteAccount}
        fullWidth
        onPress={openDelete}
      />
    </ProfileGroup>
  );

  const deleteSheet = (
    <BottomSheet
      testID="profile-delete-confirmation"
      visible={confirmingDelete}
      onClose={closeDelete}
      closeLabel={strings.profile.deleteCancel}
      title={strings.profile.deleteTitle}
      contentStyle={styles.sheet}
    >
      <AppText color="secondary">{strings.profile.deleteWarning}</AppText>
      {deleteError ? (
        <AppText
          testID="profile-delete-error"
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {deleteError}
        </AppText>
      ) : null}
      <ActionButton
        testID="profile-delete-confirm"
        variant="danger"
        icon="delete-forever-outline"
        label={deleting ? strings.profile.deleting : strings.profile.deleteConfirm}
        disabled={deleting}
        busy={deleting}
        fullWidth
        onPress={() => void confirmDelete()}
      />
      <ActionButton
        testID="profile-delete-cancel"
        variant="secondary"
        label={strings.profile.deleteCancel}
        disabled={deleting}
        fullWidth
        onPress={closeDelete}
      />
    </BottomSheet>
  );

  return (
    <ProfileSettingsShell
      testID="profile-account-app-screen"
      scrollTestID="profile-account-app-scroll"
      tvScope="profile-account-app"
      tvLeft={(
        <>
          {accountDetailsCard}
          {editForm}
          {dangerGroup}
        </>
      )}
      tvRight={(
        <>
          {languagePanel}
          {updateCard}
        </>
      )}
      overlay={deleteSheet}
    >
      {accountDetailsCard}
      {editForm}
      {languagePanel}
      {updateCard}
      {dangerGroup}
    </ProfileSettingsShell>
  );
}

const styles = StyleSheet.create({
  sheet: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.xxs },
});
