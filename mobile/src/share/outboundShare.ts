import { Share } from 'react-native';
import type { DeezerId, LyricsLine, Track } from '../api/types';
import { trackArtistLabel } from '../api/trackArtists';
import { getCurrentApiBase } from '../config';
import { strings } from '../localization';

function requireOrigin(): string {
  const base = getCurrentApiBase().trim().replace(/\/+$/u, '');
  if (base.length === 0) {
    throw new Error('Cannot build share URL without a configured server origin');
  }
  return base;
}

function requireNonEmptyId(id: DeezerId | number, label: string): string {
  const normalized = String(id).trim();
  if (normalized.length === 0) {
    throw new Error(`Cannot build share URL: ${label} is empty`);
  }
  return encodeURIComponent(normalized);
}

export function buildTrackShareUrl(track: Track): string {
  const origin = requireOrigin();
  const albumId = String(track.album_id ?? '').trim();
  if (albumId.length > 0) {
    return `${origin}/album/${encodeURIComponent(albumId)}`;
  }
  const query = `${track.title} ${trackArtistLabel(track)}`.trim();
  return `${origin}/search?q=${encodeURIComponent(query)}`;
}

export function buildAlbumShareUrl(albumId: DeezerId): string {
  return `${requireOrigin()}/album/${requireNonEmptyId(albumId, 'album id')}`;
}

export function buildArtistShareUrl(artistId: DeezerId): string {
  return `${requireOrigin()}/artist/${requireNonEmptyId(artistId, 'artist id')}`;
}

export function buildPlaylistShareUrl(playlistId: number): string {
  if (!Number.isInteger(playlistId) || playlistId <= 0) {
    throw new Error(`Cannot build share URL: invalid playlist id ${String(playlistId)}`);
  }
  return `${requireOrigin()}/playlist/${encodeURIComponent(String(playlistId))}`;
}

export function formatLyricQuoteExcerpt(
  lines: readonly LyricsLine[],
  index: number,
): string {
  if (!Number.isInteger(index) || index < 0 || index >= lines.length) {
    throw new RangeError(`Lyric quote index ${String(index)} is out of bounds`);
  }
  const selected = lines[index].text.trim();
  if (selected.length === 0) {
    throw new Error('Cannot share an empty instrumental lyric line');
  }
  const excerpt = [selected];
  const next = lines[index + 1]?.text.trim() ?? '';
  if (next.length > 0) {
    excerpt.push(next);
  }
  return excerpt.join('\n');
}

export async function shareTrack(track: Track): Promise<void> {
  const url = buildTrackShareUrl(track);
  const artist = trackArtistLabel(track);
  await Share.share({
    title: track.title,
    message: strings.share.trackMessage(track.title, artist, url),
    url,
  });
}

export async function shareAlbum(
  albumId: DeezerId,
  title: string,
  artist: string,
): Promise<void> {
  const url = buildAlbumShareUrl(albumId);
  await Share.share({
    title,
    message: strings.share.albumMessage(title, artist, url),
    url,
  });
}

export async function shareArtist(artistId: DeezerId, name: string): Promise<void> {
  const url = buildArtistShareUrl(artistId);
  await Share.share({
    title: name,
    message: strings.share.artistMessage(name, url),
    url,
  });
}

export async function sharePlaylist(playlistId: number, name: string): Promise<void> {
  const url = buildPlaylistShareUrl(playlistId);
  await Share.share({
    title: name,
    message: strings.share.playlistMessage(name, url),
    url,
  });
}

export async function shareLyricQuote(
  track: Track,
  lines: readonly LyricsLine[],
  index: number,
): Promise<void> {
  const quote = formatLyricQuoteExcerpt(lines, index);
  const url = buildTrackShareUrl(track);
  const artist = trackArtistLabel(track);
  await Share.share({
    title: track.title,
    message: strings.share.lyricQuoteMessage(quote, track.title, artist, url),
    url,
  });
}
