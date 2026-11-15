import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    alias: {
      'react-native-safe-area-context': fileURLToPath(
        new URL('./src/test/safeAreaContextStub.ts', import.meta.url),
      ),
    },
  },
});
