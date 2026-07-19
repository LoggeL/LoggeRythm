/* eslint-disable import/first */
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  state: null as unknown,
  refs: [] as { current: unknown }[],
  refIndex: 0,
  effects: [] as (() => void | (() => void))[],
  setState: vi.fn((next: unknown) => { hooks.state = next; }),
}));

const updaterMocks = vi.hoisted(() => ({
  checkForAndroidUpdate: vi.fn(),
  getInstallationInfo: vi.fn(),
  openInstallPermissionSettings: vi.fn(),
  downloadAndInstall: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    default: actual,
    useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
    useEffect: (effect: () => void | (() => void)) => {
      hooks.effects.push(effect);
    },
    useRef: (initial: unknown) => {
      const index = hooks.refIndex;
      hooks.refIndex += 1;
      if (!hooks.refs[index]) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useState: (initial: unknown) => [hooks.state ?? initial, hooks.setState],
  };
});

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'android' },
  Pressable: 'Pressable',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));

vi.mock('../../update/githubReleaseUpdater', () => ({
  androidUpdater: {
    getInstallationInfo: updaterMocks.getInstallationInfo,
    openInstallPermissionSettings: updaterMocks.openInstallPermissionSettings,
    downloadAndInstall: updaterMocks.downloadAndInstall,
  },
  checkForAndroidUpdate: updaterMocks.checkForAndroidUpdate,
  subscribeAndroidUpdateDownloadProgress: updaterMocks.subscribe,
}));

import AndroidUpdateCard from './AndroidUpdateCard';

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  if (typeof element.type === 'function') {
    const rendered = (element.type as (props: ElementProps) => React.ReactNode)(element.props);
    return [element, ...elements(rendered)];
  }
  return [element, ...elements(element.props.children)];
}

function byTestID(node: React.ReactNode, testID: string): React.ReactElement<ElementProps> | null {
  return elements(node).find((element) => (
    element.props.testID === testID && typeof element.type !== 'function'
  )) ?? null;
}

const available = {
  kind: 'available' as const,
  installedVersion: '1.0.5',
  release: {
    versionName: '1.0.6',
    tagName: 'v1.0.6',
    releaseName: 'LoggeRythm 1.0.6',
    releaseUrl: 'https://github.com/LoggeL/LoggeRythm/releases/tag/v1.0.6',
    publishedAt: '2026-07-18T00:00:00Z',
    apkName: 'LoggeRythm-v1.0.6.apk',
    apkUrl: 'https://github.com/LoggeL/LoggeRythm/releases/download/v1.0.6/LoggeRythm-v1.0.6.apk',
    apkDigest: `sha256:${'a'.repeat(64)}`,
    apkSize: 42_000_000,
  },
};

describe('AndroidUpdateCard integration behavior', () => {
  beforeEach(() => {
    hooks.state = { kind: 'ready', result: available };
    hooks.refs = [];
    hooks.refIndex = 0;
    hooks.effects = [];
    hooks.setState.mockClear();
    updaterMocks.checkForAndroidUpdate.mockReset();
    updaterMocks.getInstallationInfo.mockReset();
    updaterMocks.openInstallPermissionSettings.mockReset();
    updaterMocks.downloadAndInstall.mockReset();
    updaterMocks.subscribe.mockClear();
  });

  it('single-flights rapid install taps before native permission lookup resolves', async () => {
    let releasePermission!: (value: { versionName: string; versionCode: number; canRequestPackageInstalls: boolean }) => void;
    updaterMocks.getInstallationInfo.mockReturnValue(new Promise((resolve) => {
      releasePermission = resolve;
    }));
    updaterMocks.downloadAndInstall.mockResolvedValue({
      status: 'awaiting-user-confirmation',
      versionName: '1.0.6',
      versionCode: 10018,
    });

    const tree = AndroidUpdateCard();
    const install = byTestID(tree, 'android-update-install');
    (install?.props.onPress as () => void)();
    (install?.props.onPress as () => void)();

    expect(updaterMocks.getInstallationInfo).toHaveBeenCalledOnce();
    releasePermission({
      versionName: '1.0.5',
      versionCode: 10017,
      canRequestPackageInstalls: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(updaterMocks.downloadAndInstall).toHaveBeenCalledOnce();
  });
});
