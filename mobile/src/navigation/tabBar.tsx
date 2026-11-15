import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import AppIcon, { type AppIconName } from '../components/AppIcon';
import { colors, metrics, radii, spacing, typography } from '../theme';

const PILL_WIDTH = 56;
const PILL_HEIGHT = 30;

/**
 * Tab icon with the web tab bar's active treatment: a translucent pill
 * behind the focused icon, which is tinted accentSoft while the label stays
 * neutral. React Navigation renders it twice (focused/unfocused) and
 * cross-fades, so the pill fades in on selection.
 */
export function TabBarIcon({ focused, name }: { focused: boolean; name: AppIconName }) {
  return (
    <View style={[styles.pill, focused ? styles.pillActive : null]}>
      <AppIcon color={focused ? colors.accentSoft : colors.textMuted} name={name} size={24} />
    </View>
  );
}

/** Screen options shared by all five tabs. `bottomInset` is the bottom safe-area inset. */
export function tabBarScreenOptions(bottomInset: number): BottomTabNavigationOptions {
  return {
    headerShown: false,
    tabBarStyle: {
      height: metrics.tabBarHeight + bottomInset,
      backgroundColor: colors.backdrop,
      borderTopWidth: 1,
      borderTopColor: colors.hairline,
      paddingTop: spacing.xxs,
      paddingBottom: Math.max(bottomInset, spacing.xxs),
      elevation: 0,
    },
    tabBarItemStyle: { minHeight: metrics.minimumTouchTarget },
    tabBarIconStyle: { width: PILL_WIDTH, height: PILL_HEIGHT },
    tabBarLabelStyle: {
      fontSize: typography.micro.fontSize,
      lineHeight: typography.micro.lineHeight,
      fontWeight: typography.micro.fontWeight,
      letterSpacing: typography.micro.letterSpacing,
      marginTop: spacing.xxs / 2,
    },
    tabBarActiveTintColor: colors.textPrimary,
    tabBarInactiveTintColor: colors.textMuted,
    tabBarHideOnKeyboard: true,
  };
}

const styles = StyleSheet.create({
  pill: {
    width: PILL_WIDTH,
    height: PILL_HEIGHT,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillActive: { backgroundColor: colors.fillStrong },
});
