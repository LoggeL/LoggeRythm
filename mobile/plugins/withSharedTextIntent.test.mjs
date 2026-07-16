import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withSharedTextIntent');

describe('withSharedTextIntent native source contract', () => {
  it('advertises exactly one text/plain ACTION_SEND activity route', () => {
    const activity = { 'intent-filter': [] };
    plugin.ensureSendIntentFilter(activity);
    plugin.ensureSendIntentFilter(activity);
    expect(activity['intent-filter']).toEqual([
      {
        action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
        category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
        data: [{ $: { 'android:mimeType': 'text/plain' } }],
      },
    ]);
  });

  it('injects cold and warm ACTION_SEND intake idempotently', () => {
    const activity = `package top.logge.loggerythm

import android.os.Bundle

class MainActivity {
  fun onCreate() {
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript.
   */
}`;
    const once = plugin.transformMainActivity(activity);
    expect(once).toContain('SharedTextInbox.publishFromIntent(intent)');
    expect(once).toContain('override fun onNewIntent(intent: Intent)');
    expect(plugin.transformMainActivity(once)).toBe(once);
  });

  it('registers one owned package and bounds text without logging it', () => {
    const application = 'PackageList(this).packages.apply {\n        }';
    const transformed = plugin.transformMainApplication(application);
    expect(transformed).toContain('add(SharedTextPackage())');
    expect(plugin.transformMainApplication(transformed)).toBe(transformed);

    const sources = Object.values(plugin.kotlinSources('top.logge.loggerythm')).join('\n');
    expect(sources).toContain('intent?.action != Intent.ACTION_SEND');
    expect(sources).toContain('value.length > MAX_TEXT_LENGTH');
    expect(sources).toContain('SharedTextReceived');
    expect(sources).toContain('if (listenerCount.get() <= 0) return@subscribe');
    expect(sources).toContain('listenerCount.incrementAndGet()');
    expect(sources.indexOf('if (!emit(value))')).toBeLessThan(
      sources.indexOf('SharedTextInbox.consume(value)'),
    );
    expect(sources).toContain('}.isSuccess');
    expect(sources).not.toContain('Log.');
  });
});
