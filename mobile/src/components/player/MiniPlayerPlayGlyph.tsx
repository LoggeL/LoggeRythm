import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { colors } from '../../theme';
import AppIcon from '../AppIcon';
import { MINI_PLAYER_MOTION, easing } from './miniPlayerMotion';

/**
 * Play ⇄ pause glyph for the mini player's disc: both icons stay mounted and
 * cross-scale on the native driver, so toggling never pops. Short Buffering
 * blips (every skip has one) keep the glyph; only a stall longer than
 * `spinnerDelayMs` swaps in the spinner. The parent button owns the label and
 * `busy` state, which stay immediate.
 */
export function MiniPlayerPlayGlyph({
  playing,
  buffering,
  reducedMotion,
  size = 24,
}: {
  playing: boolean;
  buffering: boolean;
  reducedMotion: boolean;
  size?: number;
}) {
  const [progress] = useState(() => new Animated.Value(playing ? 1 : 0));
  // Mounting mid-stall shows the spinner at once; later stalls wait for the delay.
  const [stalled, setStalled] = useState(buffering);

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(playing ? 1 : 0);
      return undefined;
    }
    const animation = Animated.timing(progress, {
      toValue: playing ? 1 : 0,
      duration: MINI_PLAYER_MOTION.toggleMs,
      easing: easing.standard,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [playing, progress, reducedMotion]);

  useEffect(() => {
    if (!buffering) return undefined;
    const timer = setTimeout(() => setStalled(true), MINI_PLAYER_MOTION.spinnerDelayMs);
    return () => {
      clearTimeout(timer);
      setStalled(false);
    };
  }, [buffering]);

  const styles = useMemo(() => ({
    pause: {
      opacity: progress,
      transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
    },
    play: {
      opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }],
    },
  }), [progress]);

  if (buffering && stalled) {
    return <ActivityIndicator testID="mini-player-buffering" color={colors.onLight} size="small" />;
  }
  return (
    <View style={layout.stack} pointerEvents="none">
      <Animated.View testID="mini-player-glyph-play" style={[layout.glyph, styles.play]}>
        <AppIcon name="play" color={colors.onLight} size={size} />
      </Animated.View>
      <Animated.View testID="mini-player-glyph-pause" style={[layout.glyph, styles.pause]}>
        <AppIcon name="pause" color={colors.onLight} size={size} />
      </Animated.View>
    </View>
  );
}

const fill = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const;

const layout = StyleSheet.create({
  stack: fill,
  glyph: {
    ...fill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
