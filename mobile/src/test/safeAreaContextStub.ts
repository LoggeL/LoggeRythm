/**
 * Vitest stand-in for react-native-safe-area-context (aliased in
 * vitest.config.ts). The real package loads native view specs that cannot be
 * parsed outside Metro, and the ui barrel reaches it through BottomSheet, so
 * every component test would otherwise have to mock it by hand. Tests that
 * care about insets still override it with their own `vi.mock`.
 */
export const SafeAreaProvider = 'SafeAreaProvider';
export const SafeAreaView = 'SafeAreaView';

export function useSafeAreaInsets() {
  return { top: 0, right: 0, bottom: 0, left: 0 };
}
