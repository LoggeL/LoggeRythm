import React from 'react';
import { Text, type ColorValue, type StyleProp, type TextStyle } from 'react-native';
import glyphMap from '@react-native-vector-icons/material-design-icons/glyphmaps/MaterialDesignIcons.json';

export type AppIconName = keyof typeof glyphMap;

export interface AppIconProps {
  name: AppIconName;
  color?: ColorValue;
  size?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * The shared decorative icon primitive. Interactive parents remain the single
 * accessibility target and provide the localized role, name, and state.
 */
export default function AppIcon({
  name,
  color,
  size = 24,
  style,
  testID,
}: AppIconProps) {
  return (
    <Text
      accessible={false}
      allowFontScaling={false}
      importantForAccessibility="no"
      testID={testID}
      style={[
        {
          color,
          fontFamily: 'MaterialDesignIcons',
          fontSize: size,
          fontStyle: 'normal',
          fontWeight: 'normal',
          lineHeight: size,
        },
        style,
      ]}
    >
      {String.fromCodePoint(glyphMap[name])}
    </Text>
  );
}
