import React, { useState } from 'react';
import type { MeUpdateRequest } from '../../api/endpoints';
import type { User } from '../../api/types';
import { strings } from '../../localization';
import { profileSaveFailureMessage } from '../../screens/profileFeedback';
import {
  ProfileValidationError,
  buildProfilePatch,
  initialProfileForm,
  profilePatchHasChanges,
  type ProfileForm,
  type ProfileValidationCode,
} from '../../screens/profileModel';
import { FormField, PasswordField } from '../FormField';
import { ActionButton, AppText } from '../ui';
import { ProfileGroup } from './ProfileGroup';

export interface ProfileEditFormProps {
  user: User;
  onSave: (patch: MeUpdateRequest) => Promise<void>;
}

type FormStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'success'; message: string }
  /** `field` is set for a local validation failure, which is shown under that input. */
  | { kind: 'error'; message: string; field: keyof ProfileForm | null };

const validationField: Record<ProfileValidationCode, keyof ProfileForm> = {
  display_name_required: 'displayName',
  display_name_too_long: 'displayName',
  email_invalid: 'email',
  password_too_short: 'password',
  password_too_long: 'password',
  password_mismatch: 'confirmPassword',
};

/**
 * ProfileEditForm edits display name, email and password. Validation
 * failures appear under the offending field; a rejected save and the success
 * confirmation appear above the save button.
 */
export function ProfileEditForm({ user, onSave }: ProfileEditFormProps) {
  const [form, setForm] = useState<ProfileForm>(() => initialProfileForm({
    displayName: user.display_name,
    email: user.email,
  }));
  const [status, setStatus] = useState<FormStatus>({ kind: 'idle' });
  const saving = status.kind === 'saving';

  const update = (field: keyof ProfileForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setStatus({ kind: 'idle' });
  };

  const submit = async () => {
    if (saving) return;
    let patch: MeUpdateRequest;
    try {
      patch = buildProfilePatch(form, { displayName: user.display_name, email: user.email });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: profileSaveFailureMessage(error, strings.profile),
        field: error instanceof ProfileValidationError ? validationField[error.code] : null,
      });
      return;
    }
    if (!profilePatchHasChanges(patch)) {
      setStatus({ kind: 'success', message: strings.profile.noChanges });
      return;
    }
    setStatus({ kind: 'saving' });
    try {
      await onSave(patch);
      setForm((current) => ({ ...current, password: '', confirmPassword: '' }));
      setStatus({ kind: 'success', message: strings.profile.saved });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: profileSaveFailureMessage(error, strings.profile),
        field: null,
      });
    }
  };

  const fieldError = (field: keyof ProfileForm) =>
    status.kind === 'error' && status.field === field ? status.message : null;
  const formError = status.kind === 'error' && status.field === null ? status.message : null;

  return (
    <ProfileGroup testID="profile-edit" icon="pencil-outline" title={strings.profile.editTitle}>
      <FormField
        testID="profile-display-name"
        label={strings.profile.displayName}
        labelNativeID="profile-display-name-label"
        value={form.displayName}
        autoCapitalize="words"
        autoCorrect={false}
        editable={!saving}
        error={fieldError('displayName')}
        errorTestID="profile-save-error"
        onChangeText={(value) => update('displayName', value)}
      />
      <FormField
        testID="profile-email"
        label={strings.profile.email}
        labelNativeID="profile-email-label"
        value={form.email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!saving}
        error={fieldError('email')}
        errorTestID="profile-save-error"
        onChangeText={(value) => update('email', value)}
      />
      <PasswordField
        testID="profile-password"
        label={strings.profile.newPassword}
        labelNativeID="profile-password-label"
        value={form.password}
        autoComplete="new-password"
        editable={!saving}
        error={fieldError('password')}
        errorTestID="profile-save-error"
        hint={strings.profile.passwordHint}
        onChangeText={(value) => update('password', value)}
      />
      <PasswordField
        testID="profile-password-confirm"
        label={strings.profile.confirmPassword}
        labelNativeID="profile-password-confirm-label"
        value={form.confirmPassword}
        autoComplete="new-password"
        editable={!saving}
        error={fieldError('confirmPassword')}
        errorTestID="profile-save-error"
        onChangeText={(value) => update('confirmPassword', value)}
      />
      {formError !== null ? (
        <AppText
          testID="profile-save-error"
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {formError}
        </AppText>
      ) : null}
      {status.kind === 'success' ? (
        <AppText
          testID="profile-save-status"
          variant="callout"
          color="success"
          accessibilityLiveRegion="polite"
        >
          {status.message}
        </AppText>
      ) : null}
      <ActionButton
        testID="profile-save"
        label={saving ? strings.profile.saving : strings.profile.save}
        busy={saving}
        fullWidth
        onPress={() => void submit()}
      />
    </ProfileGroup>
  );
}
