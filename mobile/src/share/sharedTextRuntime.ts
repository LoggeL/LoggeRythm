import AsyncStorage from '@react-native-async-storage/async-storage';
import { receiveSpotifySharedText } from './spotifyImport';
import { SharedTextCoordinator } from './sharedTextCoordinator';

export const spotifySharedTextCoordinator = new SharedTextCoordinator({
  storage: AsyncStorage,
  deliver: (text, accountScope) => receiveSpotifySharedText(text, accountScope),
  onError: (phase) => {
    // Share payloads are deliberately excluded from diagnostics.
    console.error(`[LoggeRythm] shared-text ${phase} failed`);
  },
});
