import { musicRepository } from '../../data/repositories';
import { strings } from '../../localization';
import { openArtistInActiveTab } from '../../navigation/rootNavigation';
import { playTracks } from '../../player/controller';
import { reportPlayerError } from '../../player/errors';
import type { StatEntry } from '../../domain/listeningStats';

/** Play a top track directly from listening stats (resolving full Track metadata first). */
export async function playTopStatTrack(entry: StatEntry): Promise<void> {
  const trackId = entry.key.trim();
  if (trackId.length === 0) {
    const error = new Error(`Top track stat "${entry.label}" is missing a track id`);
    reportPlayerError(strings.profile.statActionFailed, error);
    throw error;
  }
  try {
    const track = await musicRepository.getTrack(trackId);
    await playTracks([track], 0, {
      radio: true,
      context: {
        type: 'recent',
        id: `top-track:${trackId}`,
        label: strings.profile.topTracks,
      },
    });
  } catch (error) {
    reportPlayerError(strings.profile.statActionFailed, error);
    throw error;
  }
}

/** Open a top artist from listening stats (resolving artist id via search if legacy play omitted it). */
export async function openTopStatArtist(entry: StatEntry): Promise<void> {
  try {
    let artistId = entry.key.trim();
    const artistName = entry.label.trim();
    if (artistId.length === 0) {
      if (artistName.length === 0) {
        throw new Error('Top artist stat has neither artist id nor artist name');
      }
      const matches = await musicRepository.searchArtists(artistName);
      const exact = matches.find(
        (candidate) => candidate.name.trim().toLocaleLowerCase('en-US') === artistName.toLocaleLowerCase('en-US'),
      );
      const resolved = exact ?? matches[0];
      if (resolved === undefined || String(resolved.id).trim().length === 0) {
        throw new Error(`No artist found matching "${artistName}"`);
      }
      artistId = String(resolved.id).trim();
    }
    const outcome = openArtistInActiveTab({
      artistId,
      name: artistName || undefined,
    });
    if (outcome !== 'opened') {
      throw new Error(`Root navigation container is not ready to open artist ${artistId}`);
    }
  } catch (error) {
    reportPlayerError(strings.profile.statActionFailed, error);
    throw error;
  }
}
