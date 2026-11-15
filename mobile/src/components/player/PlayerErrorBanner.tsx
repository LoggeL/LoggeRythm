import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { strings } from '../../localization';
import { colors, radii, spacing } from '../../theme';
import { AppText, IconButton } from '../ui';

export interface PlayerErrorBannerProps {
  /** Already user-facing player error text. */
  message: string;
  onDismiss: () => void;
  testID: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The one dismissible playback-failure banner shared by the fullscreen
 * player and the standalone queue. It announces assertively and never hides
 * or rewrites the message it is given.
 */
export function PlayerErrorBanner({ message, onDismiss, testID, style }: PlayerErrorBannerProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.banner, style]}
    >
      <AppText variant="callout" color="danger" style={styles.message}>
        {message}
      </AppText>
      <IconButton
        testID={`${testID}-dismiss`}
        icon="close"
        size="sm"
        accessibilityLabel={strings.player.playerErrorDismiss}
        onPress={onDismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.md,
    borderRadius: radii.panel,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSubtle,
  },
  message: { flex: 1, paddingVertical: spacing.xs },
});
