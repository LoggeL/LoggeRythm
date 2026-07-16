import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withMusicVolumeControl');

describe('withMusicVolumeControl MainActivity contract', () => {
  it('binds visible-app hardware keys to STREAM_MUSIC idempotently', () => {
    const activity = `package top.logge.loggerythm

import android.os.Build
import android.os.Bundle

class MainActivity {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}`;

    const once = plugin.transformMainActivity(activity);
    expect(once).toContain('import android.media.AudioManager');
    expect(once).toContain(plugin.GENERATED_MARKER);
    expect(once).toContain('override fun onResume()');
    expect(once).toContain('super.onResume()');
    expect(once).toContain('volumeControlStream = AudioManager.STREAM_MUSIC');
    expect(once.indexOf('super.onResume()')).toBeLessThan(
      once.indexOf('volumeControlStream = AudioManager.STREAM_MUSIC'),
    );
    expect(plugin.transformMainActivity(once)).toBe(once);
  });

  it('fails loudly instead of producing a partial unsupported activity', () => {
    expect(() => plugin.transformMainActivity('class MainActivity'))
      .toThrow('unsupported MainActivity body');
  });
});
