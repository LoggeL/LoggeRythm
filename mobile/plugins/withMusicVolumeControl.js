const { withMainActivity } = require('expo/config-plugins');

const GENERATED_MARKER = '// @generated withMusicVolumeControl media stream binding';

/** Keep hardware volume keys on Android's media stream while the app is visible. */
function transformMainActivity(source) {
  if (source.includes(GENERATED_MARKER)) return source;
  const anchor = '  override fun onCreate(savedInstanceState: Bundle?) {';
  if (!source.includes(anchor)) {
    throw new Error('withMusicVolumeControl: unsupported MainActivity body');
  }

  let next = source;
  if (!next.includes('import android.media.AudioManager')) {
    const importAnchor = 'import android.os.Build';
    if (!next.includes(importAnchor)) {
      throw new Error('withMusicVolumeControl: unsupported MainActivity imports');
    }
    next = next.replace(
      importAnchor,
      `import android.media.AudioManager\n${importAnchor}`,
    );
  }

  return next.replace(
    anchor,
    `  ${GENERATED_MARKER}\n  override fun onResume() {\n    super.onResume()\n    volumeControlStream = AudioManager.STREAM_MUSIC\n  }\n\n${anchor}`,
  );
}

function withMusicVolumeControl(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withMusicVolumeControl: only Kotlin MainActivity is supported');
    }
    cfg.modResults.contents = transformMainActivity(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withMusicVolumeControl;
module.exports.transformMainActivity = transformMainActivity;
module.exports.GENERATED_MARKER = GENERATED_MARKER;
