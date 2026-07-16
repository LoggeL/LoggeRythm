import type {
  GeneratedApiResponse,
  TrackWire,
} from '../../api/generated/contract';
import type { AlbumCard } from '../../domain/catalog';

export type AlbumSearchWire = GeneratedApiResponse<'search_api_search_get'>[number];

export class AlbumSearchDomainMappingError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'AlbumSearchDomainMappingError';
    this.path = path;
  }
}

function optionalText(value: unknown, path: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') {
    throw new AlbumSearchDomainMappingError(path, 'must be a string when present');
  }
  return value.trim();
}

function optionalDeezerId(value: unknown, path: string): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') {
    const canonical = value.trim();
    if (canonical.length === 0) return null;
    if (!/^\d+$/.test(canonical)) {
      throw new AlbumSearchDomainMappingError(path, 'must be a digit-only Deezer ID');
    }
    return canonical;
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  throw new AlbumSearchDomainMappingError(
    path,
    'must be a digit-only string or safe non-negative integer',
  );
}

/**
 * Convert the Track-shaped `/api/search?type=album` transport projection into
 * the only album fields product code may consume.
 */
export function mapAlbumSearchWire(
  wire: AlbumSearchWire,
  path = 'searchAlbums',
): AlbumCard {
  // Keep this mapper compile-time-bound to both the generated operation and
  // its generated component schema. Neither declaration is human-owned.
  const source: TrackWire = wire;
  const albumId = optionalDeezerId(source.album_id, `${path}.album_id`);
  const fallbackId = optionalDeezerId(source.id, `${path}.id`);
  const id = albumId ?? fallbackId;
  if (id === null) {
    throw new AlbumSearchDomainMappingError(`${path}.id`, 'has no usable album identity');
  }

  const albumTitle = optionalText(source.album, `${path}.album`);
  const fallbackTitle = optionalText(source.title, `${path}.title`);
  const title = albumTitle || fallbackTitle;
  if (title.length === 0) {
    throw new AlbumSearchDomainMappingError(`${path}.title`, 'has no usable album title');
  }

  const artistName = optionalText(source.artist, `${path}.artist`);
  const artwork = optionalText(source.cover, `${path}.cover`);
  return {
    id,
    title,
    artistName,
    artworkUrl: artwork || null,
  };
}
