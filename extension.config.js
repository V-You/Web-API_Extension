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
    return config;
  },
};
