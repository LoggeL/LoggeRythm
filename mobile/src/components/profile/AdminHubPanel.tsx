import React, { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { strings } from '../../localization';
import { spacing } from '../../theme';
import type { AppIconName } from '../AppIcon';
import { FilterChip } from '../ui';
import { ADMIN_HUB_TABS, type AdminHubTab } from './adminFormat';
import { AdminStatusSection } from './AdminStatusSection';
import { AdminStorageSection } from './AdminStorageSection';
import { AdminUsageSection } from './AdminUsageSection';
import { AdminUsersSection } from './AdminUsersSection';
import { ProfileGroup } from './ProfileGroup';

export interface AdminHubPanelProps {
  scope: string;
  apiBase: string;
  currentUserId: number;
}

const TAB_ICONS: Record<AdminHubTab, AppIconName> = {
  usage: 'chart-areaspline',
  users: 'account-group-outline',
  storage: 'database-outline',
  status: 'heart-pulse',
};

/**
 * Single cohesive Administration hub mounted inside ProfileScreen for admin
 * accounts only. Renders one active sub-tab at a time so Profile stays clean
 * and only the active section fires its queries.
 */
export default function AdminHubPanel({
  scope,
  apiBase,
  currentUserId,
}: AdminHubPanelProps) {
  const [activeTab, setActiveTab] = useState<AdminHubTab>('usage');

  return (
    <ProfileGroup
      testID="profile-admin"
      icon="shield-account-outline"
      title={strings.admin.title}
      description={strings.admin.subtitle}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        accessibilityLabel={strings.admin.tabsLabel}
        contentContainerStyle={styles.tabs}
      >
        {ADMIN_HUB_TABS.map((tab) => (
          <FilterChip
            key={tab}
            testID={`profile-admin-tab-${tab}`}
            icon={TAB_ICONS[tab]}
            label={strings.admin.tabs[tab]}
            selected={activeTab === tab}
            accessibilityRole="tab"
            onPress={() => setActiveTab(tab)}
          />
        ))}
      </ScrollView>

      {activeTab === 'usage' ? (
        <AdminUsageSection scope={scope} apiBase={apiBase} />
      ) : null}
      {activeTab === 'users' ? (
        <AdminUsersSection
          scope={scope}
          apiBase={apiBase}
          currentUserId={currentUserId}
        />
      ) : null}
      {activeTab === 'storage' ? <AdminStorageSection scope={scope} /> : null}
      {activeTab === 'status' ? (
        <AdminStatusSection scope={scope} onNavigateTab={setActiveTab} />
      ) : null}
    </ProfileGroup>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: spacing.xs },
});
