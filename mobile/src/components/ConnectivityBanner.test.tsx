import { describe, expect, it, vi } from 'vitest';
import { colors } from '../theme';
import { flatStyle, queryByTestId as byTestID, textContent } from '../test/render';
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
describe('ConnectivityBannerView', () => {
  it('announces the persistent offline state assertively without private diagnostics', () => {
    const rendered = ConnectivityBannerView({ kind: 'offline', topInset: 24 });
    expect(byTestID(rendered, 'connectivity-offline')?.props).toMatchObject({
      accessibilityRole: 'alert',
      accessibilityLiveRegion: 'assertive',
      accessibilityLabel: 'Offline. Only downloads are available.',
    });
    expect(JSON.stringify(rendered)).not.toContain('https://');
    expect(textContent(rendered)).toEqual(
      expect.arrayContaining(['Offline', 'Only downloads are available.']),
    );
  });

  it('uses the status tokens and keeps clear of the status bar', () => {
    const offline = byTestID(ConnectivityBannerView({ kind: 'offline', topInset: 24 }), 'connectivity-offline');
    const restored = byTestID(ConnectivityBannerView({ kind: 'restored' }), 'connectivity-restored');

    expect(flatStyle(offline?.props.style)).toMatchObject({
      backgroundColor: colors.warningSubtle,
      paddingTop: 24,
    });
    expect(flatStyle(restored?.props.style)).toMatchObject({
      backgroundColor: colors.successSubtle,
      paddingTop: 8,
    });
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
