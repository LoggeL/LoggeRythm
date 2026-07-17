const { withMainApplication } = require('expo/config-plugins');

const GENERATED_MARKER = '// @generated withNoHttpRedirects fail-closed OkHttp policy';
const PROVIDER_IMPORT = 'import com.facebook.react.modules.network.OkHttpClientProvider';

/**
 * React Native Android's fetch implementation is backed by OkHttp and does not
 * honor the WHATWG RequestInit.redirect option. Install a process-wide factory
 * before React Native starts so credential-bearing requests surface 3xx
 * responses instead of automatically forwarding them to another origin.
 */
function transformMainApplication(source) {
  if (source.includes(GENERATED_MARKER)) return source;

  const importAnchor =
    'import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative';
  if (!source.includes(importAnchor)) {
    throw new Error('withNoHttpRedirects: unsupported MainApplication imports');
  }

  const startupAnchor = '    loadReactNative(this)';
  if (!source.includes(startupAnchor)) {
    throw new Error('withNoHttpRedirects: unsupported MainApplication startup');
  }

  let next = source;
  if (!next.includes(PROVIDER_IMPORT)) {
    next = next.replace(importAnchor, `${importAnchor}\n${PROVIDER_IMPORT}`);
  }

  return next.replace(
    startupAnchor,
    `    ${GENERATED_MARKER}
    val noRedirectHttpClient =
      OkHttpClientProvider.createClientBuilder(applicationContext)
          .followRedirects(false)
          .followSslRedirects(false)
          .build()
    OkHttpClientProvider.setOkHttpClientFactory { noRedirectHttpClient }
${startupAnchor}`,
  );
}

function withNoHttpRedirects(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error('withNoHttpRedirects: only Kotlin MainApplication is supported');
    }
    cfg.modResults.contents = transformMainApplication(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withNoHttpRedirects;
module.exports.GENERATED_MARKER = GENERATED_MARKER;
module.exports.PROVIDER_IMPORT = PROVIDER_IMPORT;
module.exports.transformMainApplication = transformMainApplication;
