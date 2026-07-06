import { registerRootComponent } from 'expo';
import TrackPlayer from '@rntp/player';

import App from './App';

// Android: register the background event handler before the app registers, per
// RNTP V5 docs. With native command handling (see src/player/setup.ts) remote
// controls run without JS, so this handler is effectively a no-op — but the
// registration must exist. iOS treats this as a no-op.
TrackPlayer.registerBackgroundEventHandler(() => async () => {
  // No JS-side remote handling; native handles lock screen / Auto / Bluetooth.
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
