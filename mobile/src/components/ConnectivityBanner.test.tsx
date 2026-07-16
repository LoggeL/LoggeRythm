import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectivityBannerView } from './ConnectivityBanner';

vi.mock('react-native', () => ({
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('../connectivity/store', () => ({
  getConnectivitySnapshot: () => ({ status: 'unknown', showRecovery: false }),
  subscribeConnectivity: () => () => undefined,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 0, left: 0 }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ offlineMode: false, refreshUser: vi.fn() }),
}));
vi.mock('../localization', () => ({
  strings: {
    shell: {
      offlineTitle: 'Offline',
      offlineBody: 'Only downloads are available.',
      backOnlineTitle: 'Back online',
      backOnlineBody: 'Online content is available again.',
    },
  },
}));
vi.mock('../theme', () => ({
  colors: { success: '#0f0', textPrimary: '#fff', textSecondary: '#aaa', warning: '#ff0' },
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

function byTestID(node: React.ReactNode, testID: string) {
  return elements(node).find((element) => element.props.testID === testID);
}

describe('ConnectivityBannerView', () => {
  it('announces the persistent offline state assertively without private diagnostics', () => {
    const rendered = ConnectivityBannerView({ kind: 'offline', topInset: 24 });
    expect(byTestID(rendered, 'connectivity-offline')?.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
      accessibilityLabel: 'Offline. Only downloads are available.',
    });
    expect(JSON.stringify(rendered)).not.toContain('https://');
  });

  it('announces restored connectivity politely as a transient status', () => {
    const rendered = ConnectivityBannerView({ kind: 'restored' });
    expect(byTestID(rendered, 'connectivity-restored')?.props).toMatchObject({
      accessibilityRole: 'text',
      accessibilityLiveRegion: 'polite',
      accessibilityLabel: 'Back online. Online content is available again.',
    });
  });
});
