module.exports = {
  config: (config) => {
    // Node.js CLI scripts in scripts/ use fs and path which can't resolve
    // in a browser extension context. Provide empty fallbacks so the build
    // succeeds -- these files are only run via `node`, never from the bundle.
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };
    return config;
  },
};
