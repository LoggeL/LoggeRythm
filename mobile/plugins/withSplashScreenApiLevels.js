const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

/**
 * Expo config plugin: keep the release build's Android lint green with
 * expo-splash-screen.
 *
 * expo-splash-screen writes `android:windowSplashScreenBehavior` (API 33) into
 * values/styles.xml, but the app's minSdk is 24, so lint fails the release
 * build with NewApi. Older platforms ignore unknown theme attributes, so the
 * item is only marked with `tools:targetApi="33"`. Runs as a finalized mod,
 * after expo-splash-screen has written the styles.
 */
const BEHAVIOR_ITEM = '<item name="android:windowSplashScreenBehavior">';
const TARGETED_ITEM = '<item name="android:windowSplashScreenBehavior" tools:targetApi="33">';
const TOOLS_NAMESPACE = 'xmlns:tools="http://schemas.android.com/tools"';

function markSplashBehaviorApiLevel(stylesXml, stylesPath) {
  if (!stylesXml.includes(TOOLS_NAMESPACE)) {
    throw new Error(`${stylesPath} lacks the tools namespace needed to mark API 33 splash attributes`);
  }
  const plain = stylesXml.split(BEHAVIOR_ITEM).length - 1;
  const marked = stylesXml.split(TARGETED_ITEM).length - 1;
  if (plain + marked !== 1) {
    throw new Error(
      `${stylesPath} must contain exactly one android:windowSplashScreenBehavior item ` +
        `(written by expo-splash-screen); found ${plain + marked}`,
    );
  }
  return stylesXml.replace(BEHAVIOR_ITEM, TARGETED_ITEM);
}

function withSplashScreenApiLevels(config) {
  return withFinalizedMod(config, [
    'android',
    async (cfg) => {
      const stylesPath = path.join(
        cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'values', 'styles.xml',
      );
      const styles = fs.readFileSync(stylesPath, 'utf8');
      fs.writeFileSync(stylesPath, markSplashBehaviorApiLevel(styles, stylesPath));
      return cfg;
    },
  ]);
}

module.exports = withSplashScreenApiLevels;
module.exports.markSplashBehaviorApiLevel = markSplashBehaviorApiLevel;
