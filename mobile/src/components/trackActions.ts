import { Alert } from 'react-native';
import type { Track } from '../api/types';
import { addToQueue, playNext, startRadio } from '../player/controller';

export function showTrackActions(track: Track, onError: (message: string) => void): void {
  const run = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      onError(`${label}: ${(error as Error).message}`);
    }
  };

  Alert.alert(track.title, track.artist, [
    { text: 'Play next', onPress: () => void run('Play next failed', () => playNext(track)) },
    { text: 'Add to queue', onPress: () => void run('Add to queue failed', () => addToQueue(track)) },
    { text: 'Start radio', onPress: () => void run('Starting radio failed', () => startRadio(track)) },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
