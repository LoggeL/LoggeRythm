import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MixScreen from './MixScreen';

const mocks = vi.hoisted(() => ({
  refetch: vi.fn(),
  useAuth: vi.fn(),
  useQuery: vi.fn(),
  useState: vi.fn(),
}));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, default: actual, useState: mocks.useState };
});
vi.mock('react-native', () => ({
  RefreshControl: 'RefreshControl',
  ScrollView: 'ScrollView',
  StyleSheet: { create: <T,>(styles: T): T => styles },
  Text: 'Text',
  View: 'View',
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: mocks.useQuery }));
vi.mock('../auth/AuthContext', () => ({ useAuth: mocks.useAuth }));
vi.mock('../components/catalog/CatalogCards', () => ({
  CatalogActionButton: 'CatalogActionButton',
  CatalogHeroArtwork: 'CatalogHeroArtwork',
  CatalogTrackRow: 'CatalogTrackRow',
}));
vi.mock('../components/catalog/CatalogStates', () => ({
  CatalogContentStatus: 'CatalogContentStatus',
  CatalogPageGate: 'CatalogPageGate',
  CatalogRuntimeError: 'CatalogRuntimeError',
}));
vi.mock('../components/trackActions', () => ({ showTrackActions: vi.fn() }));
vi.mock('../config', () => ({
  getCurrentApiBase: () => 'https://music.example.test',
}));
vi.mock('../data', () => ({
  musicCacheScope: () => 'https://music.example.test::user:7',
  musicQueries: { homeMixes: () => ({ queryKey: ['home', 'mixes'] }) },
}));
vi.mock('../localization', () => ({
  activeLocale: 'en',
  createRuntimeCatalog: <T extends object>(catalogs: { en: T }) => catalogs.en,
  strings: {
    common: { retry: 'Retry' },
    home: {
      mixNotFound: 'Mix not found',
      mixes: 'Mixes',
      sectionLoading: (title: string) => `Loading ${title}`,
    },
  },
}));
vi.mock('../player/controller', () => ({ playTracks: vi.fn() }));
vi.mock('../theme', () => ({
  colors: {
    accent: '#7c5cff',
    background: '#000',
    danger: '#f00',
    surfaceElevated: '#111',
    textPrimary: '#fff',
    textSecondary: '#aaa',
  },
}));
vi.mock('./catalogModel', () => ({
  assertTrackCatalogRouteCallbacks: vi.fn(),
  playbackSelection: vi.fn(),
  trackContextKey: vi.fn(),
}));
vi.mock('./homeModel', () => ({
  findHomeMix: () => null,
}));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function elements(node: React.ReactNode): React.ReactElement<ElementProps>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as React.ReactElement<ElementProps>;
  return [element, ...elements(element.props.children)];
}

describe('MixScreen missing-route query state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({ user: { id: 7 } });
    mocks.useState.mockReturnValue([null, vi.fn()]);
  });

  it('keeps collection refresh/offline/error state attached when the requested key is absent', () => {
    const transportError = { status: 0, message: 'private transport detail' };
    mocks.useQuery.mockReturnValue({
      data: [{ key: 'another-mix', title: 'Another mix', subtitle: '', cover: '', tracks: [] }],
      error: transportError,
      isPending: false,
      isFetching: false,
      isStale: true,
      fetchStatus: 'idle',
      refetch: mocks.refetch,
    });

    const tree = MixScreen({
      mixKey: 'missing-mix',
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    });
    const status = elements(tree).find((element) => element.type === 'CatalogContentStatus');

    expect(elements(tree).some((element) => element.props.testID === 'mix-not-found')).toBe(true);
    expect(status?.props).toMatchObject({
      id: 'mix',
      hasData: true,
      error: transportError,
      isStale: true,
      fetchStatus: 'idle',
    });
    (status?.props.onRetry as () => void)();
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });
});
