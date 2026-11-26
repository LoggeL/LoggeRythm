import React from 'react';
import PlaybackSettingsPanel from '../components/profile/PlaybackSettingsPanel';
import { ProfileSettingsShell } from '../components/profile/ProfileChrome';
import { SleepTimerPanel } from '../components/profile/ProfileSections';

/**
 * Thematic Playback settings screen: groups account-synced playback options
 * (Crossfade, DJ transitions, Audio quality, Listening activity, Equalizer &
 * Effects) together with the local Sleep Timer.
 */
export default function PlaybackSettingsScreen() {
  const playbackPanel = <PlaybackSettingsPanel hideHeader />;
  const sleepPanel = <SleepTimerPanel />;

  return (
    <ProfileSettingsShell
      testID="profile-playback-screen"
      scrollTestID="profile-playback-scroll"
      tvScope="profile-playback"
      tvLeft={playbackPanel}
      tvRight={sleepPanel}
    >
      {playbackPanel}
      {sleepPanel}
    </ProfileSettingsShell>
  );
}
