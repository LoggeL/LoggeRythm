import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import type { PartyState } from '../../api/types';
import { triggerHaptic } from '../../hooks/useHaptics';
import { wave2Strings } from '../../localization/wave2Strings';
import { partyDisplayName } from '../../party/partyModel';
import { colors, layout, metrics, opacity, radii, spacing } from '../../theme';
import { useKeyboardInset } from '../library/useKeyboardInset';
import { spotifyImportInputStyle } from '../search/SpotifyImportForm';
import { ActionButton, AppText, BottomSheet } from '../ui';

export const PARTY_REACTION_EMOJIS = ['🔥', '❤️', '🙌', '⚡', '🎶'] as const;

export interface PartyInteractionBarProps {
  party: PartyState;
  locked: boolean;
  votingSkip: boolean;
  onVoteSkip: () => void;
  onReact: (emoji: string) => void;
}

/** Live Vote-to-Skip + Emoji Reaction bar + latest reaction toast for Party Jam 2.0. */
export function PartyInteractionBar({
  party,
  locked,
  votingSkip,
  onVoteSkip,
  onReact,
}: PartyInteractionBarProps) {
  const skipVotes = party.skip_votes ?? [];
  const skipNeeded = party.skip_votes_needed ?? 1;
  const alreadyVoted = skipVotes.includes(party.viewer_key);
  const hasCurrent = party.current_index >= 0 && party.tracks[party.current_index] !== undefined;

  return (
    <View testID="party-jam2-bar" style={styles.wrap}>
      {party.latest_reaction !== null && party.latest_reaction !== undefined ? (
        <View testID="party-latest-reaction" accessibilityLiveRegion="polite" style={styles.reactionBanner}>
          <AppText variant="title">{party.latest_reaction.emoji}</AppText>
          <AppText variant="callout" color="primary" numberOfLines={1}>
            {party.latest_reaction.member_name}
          </AppText>
        </View>
      ) : null}

      <View style={styles.controlsRow}>
        <View style={styles.emojiRow} accessibilityLabel={wave2Strings.party2.reactionsLabel}>
          {PARTY_REACTION_EMOJIS.map((emoji) => (
            <Pressable
              key={emoji}
              testID={`party-react-${emoji}`}
              accessibilityRole="button"
              accessibilityLabel={`${wave2Strings.party2.reactionsLabel}: ${emoji}`}
              disabled={locked}
              onPress={() => {
                triggerHaptic('tap');
                onReact(emoji);
              }}
              style={({ pressed }) => [styles.emojiBtn, pressed ? styles.pressed : null]}
            >
              <AppText variant="bodyStrong">{emoji}</AppText>
            </Pressable>
          ))}
        </View>

        {hasCurrent ? (
          <ActionButton
            testID="party-vote-skip"
            icon="skip-next-circle-outline"
            variant={alreadyVoted ? 'primary' : 'secondary'}
            busy={votingSkip}
            disabled={locked || alreadyVoted}
            label={
              alreadyVoted
                ? wave2Strings.party2.voteSkipVoted(skipVotes.length, skipNeeded)
                : skipVotes.length > 0
                  ? wave2Strings.party2.voteSkipProgress(skipVotes.length, skipNeeded)
                  : wave2Strings.party2.voteSkip
            }
            onPress={() => {
              triggerHaptic('commit');
              onVoteSkip();
            }}
          />
        ) : null}
      </View>
    </View>
  );
}

export interface PartySavePlaylistSheetProps {
  visible: boolean;
  party: PartyState;
  saving: boolean;
  onClose: () => void;
  onSave: (name: string, collaborative: boolean) => void;
}

export function PartySavePlaylistSheet({
  visible,
  party,
  saving,
  onClose,
  onSave,
}: PartySavePlaylistSheetProps) {
  const [name, setName] = useState(partyDisplayName(party));
  const [collaborative, setCollaborative] = useState(false);
  // The keyboard does not resize a bottom sheet; without the spacer it covers
  // the name field, the switch and the save button.
  const keyboardInset = useKeyboardInset();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      closeLabel={wave2Strings.party2.savePlaylistClose}
      title={wave2Strings.party2.savePlaylistTitle}
      testID="party-save-playlist-sheet"
    >
      <View style={styles.sheetBody}>
        <TextInput
          testID="party-save-playlist-name"
          accessibilityLabel={wave2Strings.party2.savePlaylistNameLabel}
          value={name}
          onChangeText={setName}
          placeholder={partyDisplayName(party)}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          maxLength={100}
          style={spotifyImportInputStyle}
        />
        <View style={styles.switchRow}>
          <AppText variant="bodyStrong" style={styles.flexOne}>
            {wave2Strings.party2.savePlaylistCollaborative}
          </AppText>
          <Switch
            testID="party-save-playlist-collab"
            value={collaborative}
            onValueChange={setCollaborative}
            trackColor={{ false: colors.border, true: colors.accentSolid }}
            thumbColor={collaborative ? colors.onAccent : colors.textSecondary}
          />
        </View>
        <ActionButton
          testID="party-save-playlist-submit"
          variant="primary"
          label={saving ? wave2Strings.party2.savingPlaylist : wave2Strings.party2.savePlaylistConfirm}
          busy={saving}
          disabled={saving}
          fullWidth
          onPress={() => onSave(name.trim() || partyDisplayName(party), collaborative)}
        />
      </View>
      <View testID="party-save-playlist-keyboard-spacer" style={{ height: keyboardInset }} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: layout.pagePadding,
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  reactionBanner: {
    alignSelf: 'flex-start',
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
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  emojiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xxs,
  },
  emojiBtn: {
    minWidth: metrics.minimumTouchTarget,
    minHeight: metrics.minimumTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.fill,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  pressed: {
    opacity: opacity.pressed,
  },
  sheetBody: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flexOne: {
    flex: 1,
  },
});
