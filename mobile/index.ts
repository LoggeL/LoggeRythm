import { registerRootComponent } from 'expo';
import { AppRegistry } from 'react-native';
import Player from './src/player/player';
import { hydrateApiBaseFromStoredSession } from './src/api/client';

import App from './App';
import {
  drainDurablePlaybackEvents,
  handleBackgroundPlaybackEvent,
} from './src/player/controller';
import { PLAYBACK_EVENT_HEADLESS_TASK } from './src/player/playbackEventJournal';

// Native owns scheduling and the durable lease. Foreground requests coalesce
// with this same drain, so React startup cannot process one event twice.
AppRegistry.registerHeadlessTask(
  PLAYBACK_EVENT_HEADLESS_TASK,
  () => async () => {
    try {
      await hydrateApiBaseFromStoredSession();
      await drainDurablePlaybackEvents();
    } catch {
      // Native owns the encrypted event, lease, and an already committed WorkManager successor.
      // Finishing this attempt immediately avoids React Native holding the worker/service until
      // its task timeout; the event remains unacknowledged and is retried by native scheduling.
    }
  },
);

// Android: register before the app. Transport controls remain native,
// while progress/error compatibility events retain recovery behavior.
Player.registerBackgroundEventHandler(
  () => async (event) => {
    await hydrateApiBaseFromStoredSession();
    await handleBackgroundPlaybackEvent(event);
  },
);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
