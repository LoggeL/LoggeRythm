const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin: write a monochrome status-bar/notification icon.
 *
 * Media3 (via @rntp/player) needs a small icon for the media notification. A
 * launcher icon renders as an ugly white square there, so we ship a proper
 * white-on-transparent music-note VectorDrawable that Android tints to match
 * the system. Referenced as `smallIcon: 'ic_stat_music'` in player setup.
 */
const ICON_XML = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24"
    android:tint="#FFFFFF">
  <path
      android:fillColor="#FFFFFF"
      android:pathData="M12,3v10.55c-0.59,-0.34 -1.27,-0.55 -2,-0.55 -2.21,0 -4,1.79 -4,4s1.79,4 4,4 4,-1.79 4,-4V7h4V3h-6z" />
</vector>
`;

module.exports = function withNotificationIcon(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'ic_stat_music.xml'), ICON_XML);
      return cfg;
    },
  ]);
};
