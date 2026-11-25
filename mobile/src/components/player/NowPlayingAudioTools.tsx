import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import type { Track } from '../../api/types';
import { trackArtistLabel } from '../../api/trackArtists';
import { useHaptics } from '../../hooks/useHaptics';
import { wave2Strings } from '../../localization/wave2Strings';
import { useAudioQualityPreference } from '../../player/qualityPreference';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import AppIcon from '../AppIcon';
import { AppText, BottomSheet, IconButton } from '../ui';
import { AudioEffectsSheet } from './AudioEffectsSheet';
import { MemoNowPlayingArtwork, MemoNowPlayingBackdrop } from './NowPlayingArtwork';
import { VisualizerStage } from './VisualizerStage';

/**
 * Isolated Audio Craft (EQ/Bass/Loudness/Speed/Quality) & Live Visualizer triggers
 * for NowPlayingToolsBar, keeping NowPlayingToolsBar's own state hooks minimal.
 */
export function NowPlayingAudioTools({ track }: { track: Track }) {
  const haptics = useHaptics();
  const [audioSheetOpen, setAudioSheetOpen] = useState(false);
  const [visualizerOpen, setVisualizerOpen] = useState(false);
  const quality = useAudioQualityPreference();

  return (
    <>
      <Pressable
        testID="now-playing-audio-effects"
        accessibilityRole="button"
        accessibilityLabel={wave2Strings.audioEffects.title}
        focusable
        onPress={() => {
          haptics.trigger('tap');
          setAudioSheetOpen(true);
        }}
        style={({ pressed }) => [
          styles.pill,
          quality === 'lossless' ? styles.pillActive : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <AppIcon
          name="tune-vertical"
          size={18}
          color={quality === 'lossless' ? colors.accentSoft : colors.textSecondary}
        />
        <AppText
          variant="caption"
          color={quality === 'lossless' ? 'accent' : 'secondary'}
          numberOfLines={1}
        >
          {wave2Strings.audioEffects.qualityBadges[quality]}
        </AppText>
      </Pressable>

      <IconButton
        testID="now-playing-visualizer"
        icon="equalizer"
        variant="tonal"
        haptic="tap"
        focusable
        accessibilityLabel={wave2Strings.visualizer.openButton}
        onPress={() => setVisualizerOpen(true)}
      />

      <BottomSheet
        visible={audioSheetOpen}
        onClose={() => setAudioSheetOpen(false)}
        closeLabel={wave2Strings.audioEffects.closeButton}
        testID="now-playing-audio-effects-sheet"
      >
        <AudioEffectsSheet onClose={() => setAudioSheetOpen(false)} />
      </BottomSheet>

      <Modal
        visible={visualizerOpen}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setVisualizerOpen(false)}
      >
        <View testID="now-playing-visualizer-modal" style={styles.visualizerModal}>
          <MemoNowPlayingBackdrop coverUri={track.cover} testID="visualizer-backdrop" />
          <View style={styles.visualizerHeader}>
            <AppText variant="overline" color="accent">
              {wave2Strings.visualizer.title}
            </AppText>
            <IconButton
              testID="now-playing-visualizer-close"
              icon="close"
              variant="tonal"
              focusable
              accessibilityLabel={wave2Strings.visualizer.closeButton}
              onPress={() => setVisualizerOpen(false)}
            />
          </View>
          <View style={styles.visualizerCenter}>
            <MemoNowPlayingArtwork
              coverUri={track.cover}
              style={styles.visualizerArt}
              testID="visualizer-artwork"
            />
            <View style={styles.visualizerMeta}>
              <AppText variant="title" align="center" numberOfLines={2}>
                {track.title}
              </AppText>
              <AppText variant="callout" color="secondary" align="center" numberOfLines={1}>
                {trackArtistLabel(track)}
              </AppText>
            </View>
          </View>
          <VisualizerStage active={visualizerOpen} maxBarHeight={160} />
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: metrics.minimumTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.fill,
  },
  pillActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSubtle,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  visualizerModal: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.pagePadding,
    paddingVertical: spacing.xl,
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  visualizerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  visualizerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  visualizerArt: {
    width: 220,
    height: 220,
  },
  visualizerMeta: {
    gap: spacing.xxs,
    maxWidth: 320,
  },
});
