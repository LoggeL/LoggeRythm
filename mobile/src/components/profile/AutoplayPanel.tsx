import React, { useRef, useState } from 'react';
import { AccessibilityInfo, Switch } from 'react-native';
import { strings } from '../../localization';
import { setAutoRadioEnabled } from '../../player/controller';
import Player, { useAutoRadioEnabled, usePlayerIsSetup } from '../../player/player';
import { ensurePlayer } from '../../player/setup';
import { colors } from '../../theme';
import { AppText } from '../ui';
import { ProfileGroup } from './ProfileGroup';

interface AutoplayPanelViewProps {
  enabled: boolean;
  ready: boolean;
  busy: boolean;
  error: string | null;
  onChange(enabled: boolean): void;
}

/**
 * The Autoplay setting: with it on, a queue that runs out continues with the
 * track radio of its last track instead of stopping.
 */
export function AutoplayPanelView({ enabled, ready, busy, error, onChange }: AutoplayPanelViewProps) {
  const disabled = !ready || busy;
  return (
    <ProfileGroup
      testID="profile-autoplay"
      icon="radio-tower"
      title={strings.profile.autoplayTitle}
      description={strings.profile.autoplaySubtitle}
      trailing={
        <Switch
          testID="profile-autoplay-switch"
          accessibilityLabel={strings.profile.autoplayToggle}
          accessibilityState={{ disabled, busy, checked: enabled }}
          disabled={disabled}
          value={enabled}
          onValueChange={onChange}
          trackColor={{ false: colors.border, true: colors.accentSolid }}
          thumbColor={enabled ? colors.accentSoft : colors.textSecondary}
        />
      }
    >
      {error ? (
        <AppText
          testID="profile-autoplay-error"
          variant="callout"
          color="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {error}
        </AppText>
      ) : null}
    </ProfileGroup>
  );
}

/** Applies the change through the native player and confirms it from its snapshot. */
export async function changeAutoplay(enabled: boolean): Promise<void> {
  await ensurePlayer();
  setAutoRadioEnabled(enabled);
  await Player.flush();
  if (Player.isAutoRadioEnabled() !== enabled) {
    throw new Error(`Native player kept Autoplay ${enabled ? 'off' : 'on'} after the change`);
  }
}

export default function AutoplayPanel() {
  const enabled = useAutoRadioEnabled();
  const ready = usePlayerIsSetup();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);

  const change = async (next: boolean) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await changeAutoplay(next);
      AccessibilityInfo.announceForAccessibility(
        next ? strings.profile.autoplayEnabled : strings.profile.autoplayDisabled,
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setError(`${strings.profile.autoplayFailed} (${detail})`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <AutoplayPanelView
      enabled={enabled}
      ready={ready}
      busy={busy}
      error={error}
      onChange={(next) => void change(next)}
    />
  );
}
