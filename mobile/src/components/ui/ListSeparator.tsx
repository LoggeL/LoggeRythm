import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../../theme';

export interface ListSeparatorProps {
  /** Left inset in dp, e.g. to align with row text after the artwork. */
  inset?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * ListSeparator is the 1dp hairline between list rows or grouped settings.
 * Pass it as `ItemSeparatorComponent` or place it between stacked rows; use
 * `inset` to start the line at the text column. It is invisible to
 * assistive tech.
 */
export function ListSeparator({ inset = 0, style }: ListSeparatorProps) {
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={[styles.line, { marginLeft: inset }, style]}
    />
  );
}

const styles = StyleSheet.create({
  line: { height: 1, backgroundColor: colors.hairline },
});
