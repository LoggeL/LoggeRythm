import { registerRootComponent } from 'expo';
import Player from './src/player/player';

import App from './App';
import { handleBackgroundPlaybackEvent } from './src/player/controller';

// Android: register before the app. Transport controls remain native,
// while transition/error events keep radio and play history working in background.
Player.registerBackgroundEventHandler(() => handleBackgroundPlaybackEvent);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
