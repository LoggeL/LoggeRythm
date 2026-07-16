const API_BASE_ENV = 'EXPO_PUBLIC_API_BASE';
const PRODUCTION_API_BASE = 'https://loggerythm.logge.top';

function invalidApiBase(reason) {
  // The configured value can contain credentials by mistake. Never echo it in
  // build logs, CI annotations, or crash output while rejecting the config.
  return new Error(`Invalid ${API_BASE_ENV}: ${reason}`);
}

function localApiUsesCleartext() {
  const configured = process.env.EXPO_PUBLIC_API_BASE;
  if (configured === undefined || configured.trim() === '') return false;

  let url;
  try {
    url = new URL(configured.trim());
  } catch {
    throw invalidApiBase('malformed URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalidApiBase('protocol must be http:// or https://');
  }
  if (url.username || url.password) {
    throw invalidApiBase('embedded credentials are not allowed');
  }
  if (url.search || url.hash) {
    throw invalidApiBase('query strings and fragments are not allowed');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw invalidApiBase('path must be /');
  }
  if (process.env.NODE_ENV === 'production' && url.origin !== PRODUCTION_API_BASE) {
    throw invalidApiBase('production builds must use the canonical LoggeRythm API origin');
  }
  return url.protocol === 'http:';
}

module.exports = ({ config }) => ({
  ...config,
  plugins: config.plugins.map((plugin) => {
    if (!Array.isArray(plugin) || plugin[0] !== 'expo-build-properties') return plugin;
    return [
      plugin[0],
      {
        ...plugin[1],
        android: {
          ...plugin[1].android,
          usesCleartextTraffic: localApiUsesCleartext(),
        },
      },
    ];
  }),
});
