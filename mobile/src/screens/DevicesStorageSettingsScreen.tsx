import React from 'react';
import ConnectSettingsPanel from '../components/profile/ConnectSettingsPanel';
import { ProfileSettingsShell } from '../components/profile/ProfileChrome';
import StorageCachePanel from '../components/profile/StorageCachePanel';

/**
 * Thematic Devices & Storage settings screen: groups multi-device Connect
 * preferences alongside offline downloads, Wi-Fi-only guard, and stream cache
 * management.
 */
export default function DevicesStorageSettingsScreen() {
  const connectPanel = <ConnectSettingsPanel />;
  const storagePanel = <StorageCachePanel />;

  return (
    <ProfileSettingsShell
      testID="profile-devices-storage-screen"
      scrollTestID="profile-devices-storage-scroll"
      tvScope="profile-devices-storage"
      tvLeft={connectPanel}
      tvRight={storagePanel}
    >
      {connectPanel}
      {storagePanel}
    </ProfileSettingsShell>
  );
}
