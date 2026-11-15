import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Height of the on-screen keyboard in dp, 0 while it is hidden. A bottom
 * sheet is anchored to the bottom of an edge-to-edge modal window, which the
 * keyboard does not resize, so a sheet with text inputs appends a spacer of
 * this height to keep its fields and buttons above the keyboard.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      setInset(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setInset(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  return inset;
}
