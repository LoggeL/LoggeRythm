const API_BASE_ENV = 'EXPO_PUBLIC_API_BASE';

function localApiUsesCleartext() {
  const configured = process.env.EXPO_PUBLIC_API_BASE;
  if (configured === undefined || configured.trim() === '') return false;

  let url;
  try {
    url = new URL(configured.trim());
  } catch (error) {
    throw new Error(`Invalid ${API_BASE_ENV} "${configured}": ${error.message}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Invalid ${API_BASE_ENV} "${configured}": protocol must be http:// or https://`);
  }
  if (url.username || url.password) {
    throw new Error(`Invalid ${API_BASE_ENV} "${configured}": embedded credentials are not allowed`);
  }
  if (url.search || url.hash) {
    throw new Error(`Invalid ${API_BASE_ENV} "${configured}": query strings and fragments are not allowed`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`Invalid ${API_BASE_ENV} "${configured}": path must be /`);
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
