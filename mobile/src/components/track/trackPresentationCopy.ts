import { strings } from '../../localization';
import type { TrackStateIndicatorCopy } from '../TrackStateIndicator';
import type { TrackIdentityCopy } from './TrackIdentityLinks';
import { formatTrackDuration } from './trackMetadata';

export const trackIdentityCopy: TrackIdentityCopy = {
  openAlbum: strings.trackActions.openAlbum,
  openArtist: strings.trackActions.openArtist,
  duration: strings.search.trackDuration,
  playCount: strings.search.trackPlayCount,
  popularity: strings.search.trackPopularity,
};

export const trackStateIndicatorCopy: TrackStateIndicatorCopy = {
  playing: strings.trackPresentation.playing,
  paused: strings.trackPresentation.paused,
  buffering: strings.trackPresentation.buffering,
  active: strings.trackPresentation.active,
  downloaded: strings.trackPresentation.downloaded,
  serverCached: strings.trackPresentation.serverCached,
  rollingDeviceCache: (seconds) => {
    const duration = formatTrackDuration(seconds);
    if (duration === null) {
      throw new Error('Rolling device-cache copy requires positive finite seconds');
    }
    return strings.trackPresentation.rollingDeviceCache(duration);
  },
};
