import React, { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomInset } from '../../hooks/useBottomInset';
import { colors, layout, spacing } from '../../theme';
import { TvFocusScope, useTvEnvironment, useTvFocusReturn } from '../../tv';

/**
 * Clips a non-tab profile/settings scroll viewport above Android's bottom
 * system gesture bar so scrolled content never bleeds beneath the navigation
 * pill under Expo SDK 57 edge-to-edge layout.
 */
export function ProfileBottomSafeSpacer() {
  const insets = useSafeAreaInsets();
  if (insets.bottom <= 0) return null;
  return (
    <View
      testID="profile-bottom-safe-spacer"
      pointerEvents="none"
      style={{ height: insets.bottom, backgroundColor: colors.background }}
    />
  );
}

/** Restores Android TV D-Pad scope focus when returning to a settings screen. */
export function ProfileSettingsTvFocusEffect({ scope }: { scope: string }) {
  const isFocused = useIsFocused();
  const tv = useTvEnvironment();
  useTvFocusReturn({ scope, active: isFocused, enabled: tv.isTv });
  return null;
}

export interface ProfileSettingsShellProps {
  testID: string;
  scrollTestID: string;
  tvScope: string;
  children: ReactNode;
  tvLeft: ReactNode;
  tvRight: ReactNode;
  overlay?: ReactNode;
}

/**
 * Shared responsive container for thematic profile settings screens. Keeps
 * bottom safe-area clipping and MiniPlayer clearance on phones, and switches
 * to a 2-column D-Pad-focusable layout without double overscan on Android TV.
 */
export function ProfileSettingsShell({
  testID,
  scrollTestID,
  tvScope,
  children,
  tvLeft,
  tvRight,
  overlay,
}: ProfileSettingsShellProps) {
  const bottom = useBottomInset({ hasTabBar: false });
  const tv = useTvEnvironment();

  if (tv.isTv) {
    return (
      <TvFocusScope scope={tvScope}>
        <View testID={testID} style={styles.container}>
          <ProfileSettingsTvFocusEffect scope={tvScope} />
          <ScrollView
            testID={scrollTestID}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              {
                paddingHorizontal: tv.contentPaddingHorizontal,
                paddingBottom: bottom,
              },
            ]}
          >
            <View testID={`${testID}-tv-columns`} style={[styles.tvColumns, { gap: tv.gridGap }]}>
              <View style={styles.tvColumn}>{tvLeft}</View>
              <View style={styles.tvColumn}>{tvRight}</View>
            </View>
          </ScrollView>
          {overlay}
        </View>
      </TvFocusScope>
    );
  }

  return (
    <View testID={testID} style={styles.container}>
      <ScrollView
        testID={scrollTestID}
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[styles.content, { paddingBottom: bottom }]}
      >
        {children}
      </ScrollView>
      <ProfileBottomSafeSpacer />
      {overlay}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: {
    gap: layout.stackGap,
    paddingTop: spacing.md,
    paddingHorizontal: layout.pagePadding,
  },
  tvColumns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  tvColumn: {
    flex: 1,
    minWidth: 0,
    gap: layout.stackGap,
  },
});
