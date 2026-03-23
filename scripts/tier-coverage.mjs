#!/usr/bin/env node
/**
 * RiRo settings tier coverage report -- PRD section 9.2 / 4.4.
 *
 * Reports how many settings are tier A (fully typed) vs tier B (weakly typed).
 * Run: node scripts/tier-coverage.mjs
 */

import { readFileSync } from "fs";

const RIRO_FILE = "base_data/riro_consolidated_lookup.json";

let entries;
try {
  const data = JSON.parse(readFileSync(RIRO_FILE, "utf-8"));
  entries = data.entries ?? [];
} catch (e) {
  console.error(`Failed to read ${RIRO_FILE}: ${e.message}`);
  process.exit(1);
}

const total = entries.length;
let tierA = 0;
let tierB = 0;

for (const entry of entries) {
  const hasType = entry.type != null && entry.type !== "";
  const hasPath = entry.path != null && entry.path !== "";
  if (hasType && hasPath) {
    tierA++;
  } else {
    tierB++;
  }
}

const coveragePct = ((tierA / total) * 100).toFixed(1);

console.log("RiRo settings tier coverage");
console.log("=".repeat(40));
console.log(`Total settings:  ${total}`);
console.log(`Tier A (typed):  ${tierA} (${coveragePct}%)`);
console.log(`Tier B (weakly): ${tierB} (${(100 - parseFloat(coveragePct)).toFixed(1)}%)`);
console.log();
