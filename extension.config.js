const fs = require("node:fs");
const path = require("node:path");

function patchRuntimeAssets(outputPath) {
  const manifestPath = path.join(outputPath, "manifest.json");
  const sandboxHtmlPath = path.join(outputPath, "sandbox", "sandbox.html");
  const sandboxJsPath = path.join(outputPath, "sandbox", "sandbox.js");

  if (!fs.existsSync(manifestPath) || !fs.existsSync(sandboxHtmlPath) || !fs.existsSync(sandboxJsPath)) return;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.sandbox = {
    ...manifest.sandbox,
    pages: ["sandbox/sandbox.html"],
  };
  manifest.content_security_policy = {
    ...(manifest.content_security_policy ?? {}),
    sandbox: "sandbox allow-scripts; script-src 'self' 'unsafe-eval'; object-src 'self';",
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

class RuntimeAssetsPatchPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("RuntimeAssetsPatchPlugin", (compilation) => {
      patchRuntimeAssets(compilation.outputOptions.path || compiler.outputPath);
    });
  }
}

module.exports = {
  browser: {
    chrome: {
      chromeBinary: "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    },
  },
  config: (config) => {
    if (config.mode === "production") {
      // Keep source maps in dev, but omit them from production builds.
      config.devtool = false;

      // Production bundles must not ship dev-only hot reload runtime into
      // the extension service worker or UI entrypoints.
      config.plugins = (config.plugins || []).filter((plugin) => {
        const name = plugin?.constructor?.name || "";
        return !name.includes("ReactRefresh") && !name.includes("HotModuleReplacement");
      });

      if (config.builtins?.react) {
        config.builtins.react = {
          ...config.builtins.react,
          refresh: false,
        };
      }
    }

    // Node.js CLI scripts in tools-cli/ may still appear as implicit
    // dependencies during production builds -- stub out node builtins.
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };

    // The browser bundle includes the vendored TypeScript runtime for sandbox
    // parsing/transpilation. Keep Node globals mocked, but suppress the known
    // webpack-compatible warnings emitted from typescript.js itself.
    config.node = {
      ...config.node,
      __dirname: "mock",
      __filename: "mock",
    };

    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      (warning) => {
        const resource = warning?.module?.resource || "";
        const message = warning?.message || "";
        const isTypeScriptRuntime = resource.includes("node_modules/typescript/lib/typescript.js")
          || message.includes("node_modules/typescript/lib/typescript.js");

        if (!isTypeScriptRuntime) return false;

        return message.includes("__filename")
          || message.includes("__dirname")
          || message.includes("the request of a dependency is an expression");
      },
    ];

    // Inject build timestamp and package version as global constants.
    const { CopyRspackPlugin, DefinePlugin } = require("@rspack/core");
    const pkg = require("./package.json");
    config.plugins = config.plugins || [];
    config.plugins.push(
      new CopyRspackPlugin({
        patterns: [
          { from: "offscreen", to: "offscreen" },
          { from: "sandbox/sandbox.html", to: "sandbox/sandbox.html" },
          { from: "sandbox/sandbox.js", to: "sandbox/sandbox.js" },
        ],
      }),
      new RuntimeAssetsPatchPlugin(),
      new DefinePlugin({
        __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
        __APP_VERSION__: JSON.stringify(pkg.version),
      }),
    );

    return config;
  },
};
