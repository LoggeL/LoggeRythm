import React from 'react';
import { View } from 'react-native';
import type { AlbumRouteParams, ArtistRouteParams } from '../../screens/catalogModel';
import type { SpotifyImportRequest } from '../../share/spotifyImport';
import SpotifyImportPanel from './SpotifyImportPanel';

interface SearchImportModeProps {
  accountScope: string;
  chrome: React.ReactElement;
  sharedRequest: SpotifyImportRequest | null;
  rollingDeviceCacheSeconds?: unknown;
  onOpenAlbum: (params: AlbumRouteParams) => void;
  onOpenArtist: (params: ArtistRouteParams) => void;
}

/**
 * Import mode deliberately has no fixed sibling above its list. Search chrome
 * is injected into the import owner's header so landscape and keyboard-shrunk
 * viewports can scroll every control into reach.
 */
export function SearchImportMode({
  accountScope,
  chrome,
  sharedRequest,
  rollingDeviceCacheSeconds,
  onOpenAlbum,
  onOpenArtist,
}: SearchImportModeProps) {
  return (
    <SpotifyImportPanel
      accountScope={accountScope}
      header={<View testID="search-import-mode">{chrome}</View>}
      sharedRequest={sharedRequest}
      rollingDeviceCacheSeconds={rollingDeviceCacheSeconds}
      onOpenAlbum={onOpenAlbum}
      onOpenArtist={onOpenArtist}
    />
  );
}
