import React from 'react';
import {
  Image,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../../theme';
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
  brandWash: {
    position: 'absolute',
    width: 340,
    height: 340,
    top: -120,
    left: -90,
    borderRadius: 170,
    backgroundColor: '#7c5cff14',
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
    borderRadius: 24,
    backgroundColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  frameInner: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ffffff24',
    backgroundColor: colors.surfaceElevated,
  },
  compactFrame: {
    padding: 1,
    borderRadius: 12,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  compactFrameInner: { borderRadius: 11 },
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
    borderRadius: 999,
    right: '-18%',
    bottom: '-28%',
    backgroundColor: '#7c5cff1f',
  },
  placeholderEqualizer: {
    height: '46%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
  },
  placeholderBar: {
    width: 14,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  placeholderBarShort: { height: '54%' },
  placeholderBarTall: { height: '100%' },
  placeholderBarMedium: { height: '77%' },
  placeholderBarSmall: { height: '42%' },
});
