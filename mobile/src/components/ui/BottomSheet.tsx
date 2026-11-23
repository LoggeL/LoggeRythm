import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useBackHandler } from '../../hooks/useBackHandler';
import { triggerHaptic } from '../../hooks/useHaptics';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { colors, elevation, metrics, radii, spacing, typography } from '../../theme';

export interface BottomSheetProps {
  visible: boolean;
  /** Called for scrim tap, downward drag past the threshold, and hardware back (unless `onBack` is given). */
  onClose: () => void;
  /**
   * Optional override for Android hardware/gesture Back (e.g. stepping back
   * within multi-page sheets like TrackActionsHost before closing). Defaults to `onClose`.
   */
  onBack?: () => void;
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
const EXIT_MS = 180;
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 0.9;

/** A release closes the sheet when it was dragged far or flicked down fast. */
export function shouldDismissSheet(gesture: { dy: number; vy: number }): boolean {
  return gesture.dy > DISMISS_DISTANCE || (gesture.dy > 12 && gesture.vy > DISMISS_VELOCITY);
}

/**
 * BottomSheet is the modal surface for contextual actions (track actions,
 * playlist menus, pickers): a dimming scrim linked to sheet translation, a
 * rounded sheet with a generous >=48dp drag handle hit zone, smooth slide-in
 * and slide-out transitions, Android hardware Back support, and reduced-motion
 * handling.
 */
export function BottomSheet({
  visible,
  onClose,
  onBack,
  closeLabel,
  title,
  children,
  testID,
  contentStyle,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [prevVisible, setPrevVisible] = useState(visible);
  const [exiting, setExiting] = useState(false);
  const [offset] = useState(() => new Animated.Value(visible ? 0 : ENTER_OFFSET));
  const runningAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const handleBack = onBack ?? onClose;

  if (visible !== prevVisible) {
    setPrevVisible(visible);
    setExiting(!visible && !reducedMotion);
  }

  useBackHandler(visible, () => {
    handleBack();
    return true;
  });

  useEffect(() => {
    runningAnimation.current?.stop();
    runningAnimation.current = null;
    if (visible) {
      if (reducedMotion) {
        offset.setValue(0);
        return;
      }
      offset.setValue(ENTER_OFFSET);
      const animation = Animated.spring(offset, {
        toValue: 0,
        useNativeDriver: true,
        speed: 20,
        bounciness: 2,
      });
      runningAnimation.current = animation;
      animation.start();
      return;
    }
    if (!exiting) {
      offset.setValue(ENTER_OFFSET);
      return;
    }
    const animation = Animated.timing(offset, {
      toValue: ENTER_OFFSET,
      duration: EXIT_MS,
      useNativeDriver: true,
    });
    runningAnimation.current = animation;
    animation.start(({ finished }) => {
      if (finished) setExiting(false);
    });
  }, [exiting, offset, reducedMotion, visible]);

  const scrimOpacity = useMemo(
    () =>
      offset.interpolate({
        inputRange: [0, ENTER_OFFSET],
        outputRange: [1, 0],
        extrapolate: 'clamp',
      }),
    [offset],
  );

  const dragResponder = useMemo(() => {
    const settle = () => {
      if (reducedMotion) {
        offset.setValue(0);
        return;
      }
      Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy > 4,
      onPanResponderMove: (_event, gesture) => offset.setValue(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        if (shouldDismissSheet(gesture)) {
          triggerHaptic('commit');
          onClose();
        } else {
          settle();
        }
      },
      onPanResponderTerminate: settle,
    });
  }, [offset, onClose, reducedMotion]);

  return (
    <Modal
      visible={visible || exiting}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleBack}
    >
      <View style={styles.root}>
        <Animated.View
          pointerEvents="box-none"
          style={[styles.scrimFill, { opacity: scrimOpacity }]}
        >
          <Pressable
            testID={testID ? `${testID}-scrim` : undefined}
            accessibilityRole="button"
            accessibilityLabel={closeLabel}
            focusable={false}
            onPress={onClose}
            style={styles.scrim}
          />
        </Animated.View>
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
            {title ? (
              <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
                {title}
              </Text>
            ) : null}
          </View>
          <View style={[styles.content, contentStyle]}>{children}</View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrimFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  scrim: { flex: 1, backgroundColor: colors.scrim },
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
  handleArea: {
    minHeight: metrics.minimumTouchTarget,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  handle: { width: 40, height: 4, borderRadius: radii.pill, backgroundColor: colors.fillStrong },
  title: {
    ...typography.section,
    color: colors.textPrimary,
    alignSelf: 'stretch',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  content: { flexShrink: 1, paddingHorizontal: spacing.xs },
});
