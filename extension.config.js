module.exports = {
  browser: {
    chrome: {
      chromeBinary: "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    },
  },
  config: (config) => {
    // Node.js CLI scripts in tools-cli/ may still appear as implicit
    // dependencies during production builds -- stub out node builtins.
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };

    // Inject build timestamp as a global constant.
    const { DefinePlugin } = require("@rspack/core");
    config.plugins = config.plugins || [];
    config.plugins.push(
      new DefinePlugin({
        __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
      }),
    );

    return config;
  },
};
