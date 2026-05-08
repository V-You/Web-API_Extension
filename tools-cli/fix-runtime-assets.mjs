import fs from "node:fs";
import path from "node:path";

const distRoot = path.resolve("dist");

if (!fs.existsSync(distRoot)) process.exit(0);

const outputDirs = fs.readdirSync(distRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(distRoot, entry.name))
  .filter((dir) => fs.existsSync(path.join(dir, "manifest.json")))
  .filter((dir) => fs.existsSync(path.join(dir, "sandbox", "sandbox.html")) && fs.existsSync(path.join(dir, "sandbox", "sandbox.js")));

for (const outputDir of outputDirs) {
  const manifestPath = path.join(outputDir, "manifest.json");
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