import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const plugin = require('./withNoHttpRedirects');

const mainApplicationFixture = `package top.logge.loggerythm

import android.app.Application
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative

class MainApplication : Application() {
  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}`;

function expectFailClosedPolicy(source) {
  expect(source).toContain(plugin.PROVIDER_IMPORT);
  expect(source).toContain(plugin.GENERATED_MARKER);
  expect(source).toContain('val noRedirectHttpClient =');
  expect(source).toContain(
    'OkHttpClientProvider.setOkHttpClientFactory { noRedirectHttpClient }',
  );
  expect(source).toContain('OkHttpClientProvider.createClientBuilder(applicationContext)');
  expect(source).toContain('.followRedirects(false)');
  expect(source).toContain('.followSslRedirects(false)');
  expect(source.indexOf('OkHttpClientProvider.setOkHttpClientFactory {')).toBeLessThan(
    source.indexOf('loadReactNative(this)'),
  );
}

describe('withNoHttpRedirects MainApplication contract', () => {
  it('installs the process-wide fail-closed client before React Native starts', () => {
    const once = plugin.transformMainApplication(mainApplicationFixture);
    expectFailClosedPolicy(once);
    expect(plugin.transformMainApplication(once)).toBe(once);
    expect(once.match(/setOkHttpClientFactory/g)).toHaveLength(1);
    expect(once.match(/followRedirects\(false\)/g)).toHaveLength(1);
    expect(once.match(/followSslRedirects\(false\)/g)).toHaveLength(1);
  });

  it('fails loudly for unsupported templates instead of silently weakening policy', () => {
    expect(() => plugin.transformMainApplication('class MainApplication'))
      .toThrow('unsupported MainApplication imports');
    expect(() =>
      plugin.transformMainApplication(
        'import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative',
      ),
    ).toThrow('unsupported MainApplication startup');
  });
});
