import React, { useMemo } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import type { PartyState, PartyTrack, Track } from '../../api/types';
import { wave2Strings } from '../../localization/wave2Strings';
import { partyDisplayName } from '../../party/partyModel';
import { colors, layout, radii, spacing } from '../../theme';
import { LiveLyricsPanel } from '../player/LyricsPanel';
import { MemoNowPlayingArtwork, MemoNowPlayingBackdrop } from '../player/NowPlayingArtwork';
import { VisualizerStage } from '../player/VisualizerStage';
import { AppText, Artwork, IconButton } from '../ui';
import { encodeQrMatrix } from './qrMatrix';

const QR_TARGET_PX = 148;
const QR_QUIET_ZONE_MODULES = 4;

/**
 * Encode the party join URL (or code) into a genuine ISO/IEC 18004 QR code matrix.
 */
export function buildCodeMatrix(payload: string): boolean[][] {
  return encodeQrMatrix(payload).modules;
}

function partyTrackToTrack(entry: PartyTrack): Track {
  return {
    id: entry.deezer_id,
    title: entry.title,
    artist: entry.artist,
    artist_id: entry.artist_id,
    artists: entry.artists,
    album: entry.album,
    album_id: entry.album_id,
    cover: entry.cover,
    duration_sec: entry.duration_sec,
    preview_url: null,
    rank: 0,
    release_date: '',
    ...(entry.loudness_gain_db === undefined ? {} : { loudness_gain_db: entry.loudness_gain_db }),
  };
}

export interface PartyKioskContentProps {
  party: PartyState;
  joinUrl: string;
  onClose: () => void;
  onSeek?: (seconds: number) => void;
}

/** Pure Party-Screen kiosk layout: visualizer + big artwork + live karaoke lyrics + up next + join code. */
export function PartyKioskContent({
  party,
  joinUrl,
  onClose,
  onSeek,
}: PartyKioskContentProps) {
  const window = useWindowDimensions();
  const isWide = window.width >= 720;
  const currentEntry = party.current_index >= 0 ? party.tracks[party.current_index] ?? null : null;
  const currentTrack = useMemo(
    () => (currentEntry !== null ? partyTrackToTrack(currentEntry) : null),
    [currentEntry],
  );
  const upNext = useMemo(() => {
    const start = party.current_index >= 0 ? party.current_index + 1 : 0;
    return party.tracks.slice(start, start + 4);
  }, [party.current_index, party.tracks]);
  const qrPayload = joinUrl.trim() || party.code.trim();
  const matrix = useMemo(() => buildCodeMatrix(qrPayload), [qrPayload]);
  const modulePx = Math.max(
    2,
    Math.floor(QR_TARGET_PX / (matrix.length + QR_QUIET_ZONE_MODULES * 2)),
  );
  const quietZonePx = modulePx * QR_QUIET_ZONE_MODULES;

  return (
    <View testID="party-kiosk-screen" style={styles.root}>
      <MemoNowPlayingBackdrop coverUri={currentEntry?.cover ?? null} testID="party-kiosk-backdrop" />

      <View style={styles.topBar}>
        <View style={styles.topTitle}>
          <AppText variant="overline" color="accent">
            {wave2Strings.party2.kioskTitle}
          </AppText>
          <AppText variant="title" numberOfLines={1}>
            {partyDisplayName(party)}
          </AppText>
        </View>
        {party.latest_reaction !== null && party.latest_reaction !== undefined ? (
          <View testID="party-kiosk-reaction" style={styles.reactionPill}>
            <AppText variant="title">{party.latest_reaction.emoji}</AppText>
            <AppText variant="caption" color="primary" numberOfLines={1}>
              {party.latest_reaction.member_name}
            </AppText>
          </View>
        ) : null}
        <IconButton
          testID="party-kiosk-close"
          icon="close"
          variant="tonal"
          focusable
          accessibilityLabel={wave2Strings.party2.kioskClose}
          onPress={onClose}
        />
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, isWide ? styles.wideGrid : null]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.primaryCol, isWide ? styles.widePrimary : null]}>
          <View style={styles.heroRow}>
            <MemoNowPlayingArtwork
              coverUri={currentEntry?.cover ?? null}
              style={isWide ? styles.artWide : styles.artCompact}
              testID="party-kiosk-artwork"
            />
            <View style={styles.heroMeta}>
              <AppText variant="hero" numberOfLines={2}>
                {currentEntry?.title ?? partyDisplayName(party)}
              </AppText>
              {currentEntry !== null ? (
                <AppText variant="section" color="secondary" numberOfLines={1}>
                  {currentEntry.artist}
                </AppText>
              ) : null}
              {currentEntry !== null && currentEntry.added_by.trim().length > 0 ? (
                <AppText testID="party-kiosk-added-by" variant="caption" color="accent">
                  {wave2Strings.party2.kioskAddedBy(currentEntry.added_by)}
                </AppText>
              ) : null}
            </View>
          </View>

          <VisualizerStage active maxBarHeight={isWide ? 140 : 108} testID="party-kiosk-visualizer" />

          <View testID="party-kiosk-up-next" style={styles.upNextCard}>
            <AppText variant="overline" color="secondary">
              {wave2Strings.party2.kioskUpNext}
            </AppText>
            {upNext.length === 0 ? (
              <AppText variant="caption" color="muted">
                {wave2Strings.party2.kioskEmptyUpNext}
              </AppText>
            ) : (
              upNext.map((track) => (
                <View key={track.id} style={styles.upNextRow}>
                  <Artwork uri={track.cover} size={36} icon="music-note" />
                  <View style={styles.upNextCopy}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {track.title}
                    </AppText>
                    <AppText variant="caption" color="secondary" numberOfLines={1}>
                      {track.artist}
                      {track.added_by ? ` · ${track.added_by}` : ''}
                    </AppText>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={[styles.secondaryCol, isWide ? styles.wideSecondary : null]}>
          <View testID="party-kiosk-join-card" style={styles.joinCard}>
            <View
              testID="party-kiosk-qr"
              style={[styles.matrixFrame, { padding: quietZonePx }]}
              accessible={false}
            >
              {matrix.map((row, rIdx) => (
                <View key={rIdx} style={styles.matrixRow}>
                  {row.map((filled, cIdx) => (
                    <View
                      key={cIdx}
                      style={[
                        { width: modulePx, height: modulePx },
                        filled ? styles.matrixCellFilled : styles.matrixCellEmpty,
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
            <View style={styles.joinCopy}>
              <AppText variant="overline" color="muted">
                {wave2Strings.party2.kioskCodeLabel}
              </AppText>
              <AppText testID="party-kiosk-code" variant="display" color="accent" selectable>
                {party.code}
              </AppText>
              <AppText variant="caption" color="secondary" numberOfLines={2}>
                {joinUrl || wave2Strings.party2.kioskJoinHint}
              </AppText>
            </View>
          </View>

          {currentTrack !== null ? (
            <View testID="party-kiosk-lyrics" style={styles.lyricsCard}>
              <LiveLyricsPanel
                track={currentTrack}
                onSeek={(seconds) => onSeek?.(seconds)}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

export interface PartyKioskModalProps extends PartyKioskContentProps {
  visible: boolean;
}

export function PartyKioskModal({
  visible,
  party,
  joinUrl,
  onClose,
  onSeek,
}: PartyKioskModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {visible ? (
        <PartyKioskContent
          party={party}
          joinUrl={joinUrl}
          onClose={onClose}
          onSeek={onSeek}
        />
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: layout.pagePadding,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  topTitle: {
    flex: 1,
    minWidth: 0,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  wideGrid: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  primaryCol: {
    gap: spacing.md,
  },
  widePrimary: {
    flex: 1.15,
    minWidth: 0,
  },
  secondaryCol: {
    gap: spacing.md,
  },
  wideSecondary: {
    flex: 0.85,
    minWidth: 0,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  artWide: {
    width: 148,
    height: 148,
  },
  artCompact: {
    width: 104,
    height: 104,
  },
  heroMeta: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  upNextCard: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    gap: spacing.sm,
  },
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  upNextCopy: {
    flex: 1,
    minWidth: 0,
  },
  joinCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.accentSubtle,
  },
  matrixFrame: {
    borderRadius: radii.sm,
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-start',
  },
  matrixRow: {
    flexDirection: 'row',
  },
  matrixCellFilled: {
    backgroundColor: '#000000',
  },
  matrixCellEmpty: {
    backgroundColor: '#FFFFFF',
  },
  joinCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  lyricsCard: {
    height: 260,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
});
