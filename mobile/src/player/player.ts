import { getDefaultPlayerPort } from './nativePlayerPort';
import type { PlayerPort } from './playerPort';

/** Lazy drop-in default keeps imports safe before React Native links the module. */
const Player = new Proxy({} as PlayerPort, {
  get(_target, property) {
    const player = getDefaultPlayerPort();
    const value = Reflect.get(player, property, player) as unknown;
    return typeof value === 'function' ? value.bind(player) : value;
  },
});

export default Player;
export * from './playerPort';
export * from './playerState';
export * from './nativePlayerPort';
export * from './playerHooks';
