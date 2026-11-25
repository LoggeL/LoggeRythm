import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, elevation, radii, spacing } from '../../theme';
import { useArtworkPalette } from '../../hooks/useArtworkPalette';
import { usableHiResCover } from './coverUrl';

export const NOW_PLAYING_COVER_SIZE = 1000;
export const NOW_PLAYING_BACKDROP_COVER_SIZE = 480;
export const NOW_PLAYING_BACKDROP_BLUR = 36;

export interface NowPlayingBackdropProps {
  coverUri?: string | null;
  testID?: string;
}

/**
 * Static full-surface ambience derived from the active cover.
 *
 * It is deliberately non-interactive and hidden as one accessibility subtree;
 * transport and metadata own all TalkBack semantics in the parent screen.
 */
const BackdropPaletteWash = React.memo(function BackdropPaletteWash({
  uri,
  testID,
}: {
  uri: string | null;
  testID: string;
}) {
  const ambience = useArtworkPalette(uri);
  if (ambience === null) return null;
  return (
    <>
      <View
        testID={`${testID}-palette-wash`}
        accessible={false}
        style={[styles.paletteWash, { backgroundColor: ambience.surfaceTint }]}
      />
      <View
        testID={`${testID}-palette-glow`}
        accessible={false}
        style={[styles.brandWash, { backgroundColor: ambience.glowColor, opacity: 0.16 }]}
      />
    </>
  );
});

export function NowPlayingBackdrop({
  coverUri,
  testID = 'now-playing-backdrop',
}: NowPlayingBackdropProps) {
  const uri = usableHiResCover(coverUri, NOW_PLAYING_BACKDROP_COVER_SIZE);
  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.backdrop}
    >
      {uri !== null ? (
        <Image
          testID={`${testID}-image`}
          accessible={false}
          accessibilityIgnoresInvertColors
          source={{ uri }}
          resizeMode="cover"
          resizeMethod="resize"
          blurRadius={NOW_PLAYING_BACKDROP_BLUR}
          fadeDuration={0}
          style={styles.backdropImage}
        />
      ) : null}
      <View testID={`${testID}-brand-wash`} accessible={false} style={styles.brandWash} />
      <BackdropPaletteWash uri={uri} testID={testID} />
      <View accessible={false} style={styles.backdropDim} />
    </View>
  );
}

export interface NowPlayingArtworkProps {
  coverUri?: string | null;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * High-resolution square cover with a quiet edge and static shadow.
 * The adjacent title/artist already describe the media, so this visual does
 * not add a duplicate TalkBack stop.
 */
export function NowPlayingArtwork({
  coverUri,
  compact = false,
  style,
  testID = 'now-playing-artwork',
}: NowPlayingArtworkProps) {
  const uri = usableHiResCover(coverUri, NOW_PLAYING_COVER_SIZE);
  return (
    <View
      testID={testID}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.frame, compact && styles.compactFrame, style]}
    >
      <View style={[styles.frameInner, compact && styles.compactFrameInner]}>
        {uri !== null ? (
          <Image
            testID={`${testID}-image`}
            accessible={false}
            accessibilityIgnoresInvertColors
            source={{ uri }}
            resizeMode="cover"
            resizeMethod="resize"
            fadeDuration={0}
            style={styles.artworkImage}
          />
        ) : (
          <View
            testID={`${testID}-placeholder`}
            accessible={false}
            style={styles.placeholder}
          >
            <View accessible={false} style={styles.placeholderGlow} />
            <View
              testID={`${testID}-placeholder-equalizer`}
              accessible={false}
              style={styles.placeholderEqualizer}
            >
              <View style={[styles.placeholderBar, styles.placeholderBarShort]} />
              <View style={[styles.placeholderBar, styles.placeholderBarTall]} />
              <View style={[styles.placeholderBar, styles.placeholderBarMedium]} />
              <View style={[styles.placeholderBar, styles.placeholderBarSmall]} />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

/** Memoized wrappers prevent blur/image churn on unrelated screen updates. */
export const MemoNowPlayingBackdrop = React.memo(NowPlayingBackdrop);
export const MemoNowPlayingArtwork = React.memo(NowPlayingArtwork);

const absoluteFill = {
  position: 'absolute' as const,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

const styles = StyleSheet.create({
  backdrop: {
    ...absoluteFill,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  backdropImage: {
    ...absoluteFill,
    opacity: 0.25,
    transform: [{ scale: 1.16 }],
  },
  paletteWash: {
    ...absoluteFill,
    opacity: 0.24,
  },
  brandWash: {
    position: 'absolute',
    width: 340,
    height: 340,
    top: -120,
    left: -90,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    opacity: 0.08,
  },
  backdropDim: {
    ...absoluteFill,
    backgroundColor: `${colors.background}df`,
  },
  frame: {
    width: '100%',
    maxWidth: 440,
    aspectRatio: 1,
    alignSelf: 'center',
    padding: 1,
    borderRadius: radii.xl,
    backgroundColor: colors.border,
    ...elevation.floating,
  },
  frameInner: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: radii.xl - 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    backgroundColor: colors.surfaceElevated,
  },
  compactFrame: { borderRadius: radii.md, ...elevation.none, shadowOpacity: 0 },
  compactFrameInner: { borderRadius: radii.md - 1 },
  artworkImage: { width: '100%', height: '100%' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  placeholderGlow: {
    position: 'absolute',
    width: '82%',
    aspectRatio: 1,
    borderRadius: radii.pill,
    right: '-18%',
    bottom: '-28%',
    backgroundColor: colors.accent,
    opacity: 0.12,
  },
  placeholderEqualizer: {
    height: '46%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  placeholderBar: {
    width: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  placeholderBarShort: { height: '54%' },
  placeholderBarTall: { height: '100%' },
  placeholderBarMedium: { height: '77%' },
  placeholderBarSmall: { height: '42%' },
});
