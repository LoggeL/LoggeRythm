import React, { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { strings } from '../../localization';
import { spacing } from '../../theme';
import { androidUpdateFailure, type AndroidUpdateFailure } from '../../update/updateErrors';
import { ActionButton, AppText } from '../ui';

export interface AndroidReleaseLinkProps {
  url: string;
  label: string;
  testID: string;
}

/**
 * Ghost button that opens a GitHub release page in the browser. A rejected
 * `Linking.openURL` stays visible below the button with its raw detail.
 */
export function AndroidReleaseLink({ url, label, testID }: AndroidReleaseLinkProps) {
  const [failure, setFailure] = useState<AndroidUpdateFailure | null>(null);
  const update = strings.profile.update;

  const open = () => {
    setFailure(null);
    void Linking.openURL(url).catch((error: unknown) => {
      setFailure(androidUpdateFailure(error));
    });
  };

  return (
    <View style={styles.box}>
      <ActionButton
        testID={testID}
        variant="ghost"
        icon="open-in-new"
        label={label}
        onPress={open}
      />
      {failure ? (
        <>
          <AppText
            testID={`${testID}-error`}
            variant="callout"
            color="danger"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            {update.errors.linkFailed}
          </AppText>
          <AppText testID={`${testID}-error-detail`} variant="caption" color="muted" selectable>
            {update.detail(failure.code ?? 'error', failure.message)}
          </AppText>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'flex-start', gap: spacing.xxs },
});
