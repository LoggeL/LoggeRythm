import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, elevation, radii, spacing, typography } from '../../theme';

export interface BottomSheetProps {
  visible: boolean;
  /** Called for scrim tap, hardware back and a downward drag past the threshold. */
  onClose: () => void;
  /** Localized screen-reader name of the scrim's dismiss action. */
  closeLabel: string;
  title?: string;
  children: React.ReactNode;
  /** testID of the sheet; the scrim gets `${testID}-scrim`, the handle `${testID}-handle`. */
  testID?: string;
  /** Style of the content container below the handle/title. */
  contentStyle?: StyleProp<ViewStyle>;
}

const ENTER_OFFSET = 320;
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.9;

/** A release closes the sheet when it was dragged far or flicked down fast. */
export function shouldDismissSheet(gesture: { dy: number; vy: number }): boolean {
  return gesture.dy > DISMISS_DISTANCE || (gesture.dy > 12 && gesture.vy > DISMISS_VELOCITY);
}

/**
 * BottomSheet is the modal surface for contextual actions (track actions,
 * playlist menus, pickers): a dimming scrim, a rounded sheet that springs up
 * from the bottom, a drag handle that dismisses on a downward drag, and
 * bottom safe-area padding. It is controlled (`visible` + `onClose`); hardware
 * back and scrim taps both call `onClose`. Put rows/buttons inside as
 * children — for long content wrap them in a ScrollView.
 */
export function BottomSheet({
  visible,
  onClose,
  closeLabel,
  title,
  children,
  testID,
  contentStyle,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [offset] = useState(() => new Animated.Value(ENTER_OFFSET));

  useEffect(() => {
    if (!visible) return;
    offset.setValue(ENTER_OFFSET);
    Animated.spring(offset, {
      toValue: 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 2,
    }).start();
  }, [offset, visible]);

  const dragResponder = useMemo(() => {
    const settle = () =>
      Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 4,
      onPanResponderMove: (_event, gesture) => offset.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        if (shouldDismissSheet(gesture)) onClose();
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [offset, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          testID={testID ? `${testID}-scrim` : undefined}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={styles.scrim}
        />
        <Animated.View
          testID={testID}
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + spacing.md, transform: [{ translateY: offset }] },
          ]}
        >
          <View
            testID={testID ? `${testID}-handle` : undefined}
            style={styles.handleArea}
            {...dragResponder.panHandlers}
          >
            <View style={styles.handle} />
          </View>
          {title ? (
            <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>{title}</Text>
          ) : null}
          <View style={[styles.content, contentStyle]}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.hairline,
    ...elevation.sheet,
  },
  handleArea: { height: 28, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.fillStrong },
  title: {
    ...typography.section,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  content: { flexShrink: 1, paddingHorizontal: spacing.xs },
});
