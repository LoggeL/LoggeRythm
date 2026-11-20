import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { markSplashBehaviorApiLevel } = require('./withSplashScreenApiLevels');

const STYLES = `<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="Theme.App.SplashScreen" parent="Theme.SplashScreen">
    <item name="windowSplashScreenBackground">@color/splashscreen_background</item>
    <item name="android:windowSplashScreenBehavior">icon_preferred</item>
  </style>
</resources>`;

describe('withSplashScreenApiLevels', () => {
  it('marks the API 33 splash behaviour so release lint accepts minSdk 24', () => {
    const marked = markSplashBehaviorApiLevel(STYLES, 'styles.xml');
    expect(marked).toContain(
      '<item name="android:windowSplashScreenBehavior" tools:targetApi="33">icon_preferred</item>',
    );
    expect(markSplashBehaviorApiLevel(marked, 'styles.xml')).toBe(marked);
  });

  it('fails loudly when expo-splash-screen did not write the behaviour item', () => {
    const missing = STYLES.replace(/\s*<item name="android:windowSplashScreenBehavior">[^<]*<\/item>/, '');
    expect(() => markSplashBehaviorApiLevel(missing, 'styles.xml')).toThrow(
      'styles.xml must contain exactly one android:windowSplashScreenBehavior item',
    );
    expect(() => markSplashBehaviorApiLevel(STYLES.replace(' xmlns:tools="http://schemas.android.com/tools"', ''), 'styles.xml'))
      .toThrow('lacks the tools namespace');
  });
});
