import { registerRootComponent } from 'expo';
import TrackPlayer from '@rntp/player';

import App from './App';
import { handleBackgroundPlaybackEvent } from './src/player/controller';

// Android: register before the app per RNTP V5. Transport controls remain native,
// while transition/error events keep radio and play history working in background.
TrackPlayer.registerBackgroundEventHandler(() => handleBackgroundPlaybackEvent);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
