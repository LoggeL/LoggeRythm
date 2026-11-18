import { describe, expect, it } from 'vitest';
import { decodeReleaseRadar, decodeTrack } from '../api/decoders';
import {
  attachDownloadedTrack,
  attachIndividualDownloadedTrack,
  beginPlaylistDownload,
  createEmptyOfflineManifest,
  decodeOfflineManifest,
} from '../offline/model';
import { mediaItemToTrack, trackToMediaItem } from '../player/mediaItem';
import { releaseRadarTracks } from './releaseRadar';

/**
 * The radar reason exists only at the radar boundary. A track taken from the
 * radar must behave exactly like the same track from any other endpoint in
 * everything that persists or re-validates tracks: the native queue, like
 * requests and the offline manifest with its exact-key checks.
 */
const plainWireTrack = {
  id: '3135556',
  title: 'New Song',
  artist: 'Stranger',
  artist_id: '999',
  artists: [{ id: '999', name: 'Stranger' }, { id: '7', name: 'Known Artist' }],
  album: 'New Album',
  album_id: '12',
  cover: 'https://img.test/cover.jpg',
  duration_sec: 180,
  preview_url: null,
  rank: 5,
  release_date: '2026-03-01',
  // The API serialises these on every track, usually as null.
  loudness_gain_db: null,
  loudness_lufs: null,
  loudness_peak: null,
};
const radarWireTrack = {
  ...plainWireTrack,
  radar_reason: { kind: 'played', artist_id: '7', artist_name: 'Known Artist', play_count: 4 },
};
const scope = 'https://music.test::user:7';
const downloadedAt = '2026-07-16T12:00:00.000Z';

describe('Release Radar track boundary', () => {
  const [entry] = decodeReleaseRadar([radarWireTrack]);
  const [radarTrack] = releaseRadarTracks([entry]);

  it('hands out a track identical to the same track from a plain Track endpoint', () => {
    expect(radarTrack).toBe(entry.track);
    expect(radarTrack).toEqual(decodeTrack(plainWireTrack));
    expect(JSON.stringify(radarTrack)).toBe(JSON.stringify(decodeTrack(plainWireTrack)));
  });

  it('plays and queues without the reason entering the native media item', () => {
    const item = trackToMediaItem(radarTrack, 'https://api.test', { Cookie: 'session=test' });

    expect(item.extras?.track).toEqual(decodeTrack(plainWireTrack));
    expect(JSON.stringify(item)).not.toContain('radar_reason');
    expect(mediaItemToTrack(item)).toEqual(radarTrack);
  });

  it('sends a like request body without the reason', () => {
    // likeTrack and addToPlaylist post the Track itself as the JSON body.
    expect(JSON.parse(JSON.stringify(radarTrack))).toEqual(plainWireTrack);
  });

  it('downloads individually and survives the strict offline manifest round trip', () => {
    const manifest = attachIndividualDownloadedTrack(
      createEmptyOfflineManifest(scope),
      radarTrack,
      4_096,
      downloadedAt,
    );

    expect(manifest.tracks[radarTrack.id].track).toEqual(decodeTrack(plainWireTrack));
    expect(decodeOfflineManifest(JSON.stringify(manifest), scope)).toEqual(manifest);
  });

  it('downloads as part of an offline playlist snapshot', () => {
    const source = { id: 4, name: 'From the radar', tracks: [radarTrack] };
    const started = beginPlaylistDownload(createEmptyOfflineManifest(scope), source, downloadedAt);
    const manifest = attachDownloadedTrack(started, 4, radarTrack, 4_096, downloadedAt);

    expect(decodeOfflineManifest(JSON.stringify(manifest), scope)).toEqual(manifest);
  });

  it('would be rejected by the offline manifest if the reason lived on the track itself', () => {
    // This is why the radar is decoded into { track, radar_reason } entries
    // instead of a Track with one more field.
    const flat = { ...radarTrack, radar_reason: entry.radar_reason };

    expect(() =>
      attachIndividualDownloadedTrack(createEmptyOfflineManifest(scope), flat, 4_096, downloadedAt),
    ).toThrow('Individually downloaded track has unexpected fields');
  });
});
