import fs from "node:fs";
import path from "node:path";

const distManifestPath = path.resolve("dist/chrome/manifest.json");

if (!fs.existsSync(distManifestPath)) {
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(distManifestPath, "utf8"));
if (manifest.sandbox?.pages) {
  manifest.sandbox.pages = ["sandbox/sandbox.html"];
  fs.writeFileSync(distManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const sandboxHtmlPath = path.resolve("dist/chrome/sandbox/sandbox.html");
const sandboxJsPath = path.resolve("dist/chrome/sandbox/sandbox.js");

if (!fs.existsSync(sandboxHtmlPath) || !fs.existsSync(sandboxJsPath)) {
  throw new Error("Static sandbox assets were not copied into dist/chrome/sandbox.");
}