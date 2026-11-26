import { strings } from '../../localization';
import type { TrackStateIndicatorCopy } from '../TrackStateIndicator';
import type { TrackIdentityCopy } from './TrackIdentityLinks';
import { formatTrackDuration } from './trackMetadata';

// `strings` resolves the active locale on access. Reading it here at module
// load would freeze every row's copy in the start-up language, so each entry
// looks its string up when it is used.
export const trackIdentityCopy: TrackIdentityCopy = {
  openAlbum: (album) => strings.trackActions.openAlbum(album),
  openArtist: (artist) => strings.trackActions.openArtist(artist),
  duration: (value) => strings.search.trackDuration(value),
  playCount: (plays, listeners) => strings.search.trackPlayCount(plays, listeners),
  popularity: (percent) => strings.search.trackPopularity(percent),
};

export const trackStateIndicatorCopy: TrackStateIndicatorCopy = {
  get playing() { return strings.trackPresentation.playing; },
  get paused() { return strings.trackPresentation.paused; },
  get buffering() { return strings.trackPresentation.buffering; },
  get active() { return strings.trackPresentation.active; },
  get downloaded() { return strings.trackPresentation.downloaded; },
  get serverCached() { return strings.trackPresentation.serverCached; },
  rollingDeviceCache: (seconds) => {
    const duration = formatTrackDuration(seconds);
    if (duration === null) {
      throw new Error('Rolling device-cache copy requires positive finite seconds');
    }
    return strings.trackPresentation.rollingDeviceCache(duration);
  },
};
