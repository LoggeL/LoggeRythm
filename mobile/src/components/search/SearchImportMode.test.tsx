import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchImportMode } from './SearchImportMode';

vi.mock('react-native', () => ({ View: 'View' }));
vi.mock('./SpotifyImportPanel', () => ({ default: 'SpotifyImportPanel' }));

type ElementProps = Record<string, unknown> & { children?: React.ReactNode };

function propsOf(node: React.ReactNode): ElementProps {
  if (node === null || typeof node !== 'object' || !('props' in node)) {
    throw new Error('Expected a React element');
  }
  return (node as React.ReactElement<ElementProps>).props;
}

describe('Search import constrained-height ownership', () => {
  it('restarts the import panel for a new shared URL while import mode is already open', () => {
    const base = {
      accountScope: 'origin::user:7',
      chrome: React.createElement('SearchChrome'),
      onOpenAlbum: vi.fn(),
      onOpenArtist: vi.fn(),
    };
    const firstRequest = {
      id: 10,
      accountScope: base.accountScope,
      link: 'https://open.spotify.com/playlist/first',
      errorCode: null,
    };
    const nextRequest = {
      ...firstRequest,
      id: 11,
      link: 'https://open.spotify.com/album/next',
    };
    const first = SearchImportMode({ ...base, sharedRequest: firstRequest });
    const next = SearchImportMode({ ...base, sharedRequest: nextRequest });
    const manual = SearchImportMode({ ...base, sharedRequest: null });

    expect(next.key).not.toBe(first.key);
    expect(manual.key).not.toBe(next.key);
    expect(next.props.sharedRequest).toBe(nextRequest);
  });

  it('puts Search chrome inside the import owner instead of a fixed landscape/keyboard sibling', () => {
    const chrome = React.createElement('SearchChrome', { testID: 'search-chrome' });
    const onOpenAlbum = vi.fn();
    const onOpenArtist = vi.fn();
    const rendered = SearchImportMode({
      accountScope: 'origin::user:7',
      chrome,
      sharedRequest: null,
      rollingDeviceCacheSeconds: 75,
      onOpenAlbum,
      onOpenArtist,
    });

    expect(rendered.type).toBe('SpotifyImportPanel');
    expect(rendered.props).toMatchObject({
      accountScope: 'origin::user:7',
      sharedRequest: null,
      rollingDeviceCacheSeconds: 75,
      onOpenAlbum,
      onOpenArtist,
    });
    const ownerHeader = propsOf(rendered.props.header as React.ReactNode);
    expect(ownerHeader.testID).toBe('search-import-mode');
    expect(ownerHeader.children).toBe(chrome);
  });
});
