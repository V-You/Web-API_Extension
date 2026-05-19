#!/usr/bin/env node
/**
 * audit-sdk-surface.mjs
 *
 * One-screen audit of SDK surface drift across three sources of truth:
 *
 *   1. Runtime facade  -- src/sandbox/sdk-facade.ts (sandbox path)
 *   2. Runtime facade  -- background/sw-job-executor.ts buildSwSdk (job path)
 *   3. Generated types -- src_data/webapi-sdk.d.ts (flat WebApiSdk interface)
 *   4. Prompt block    -- src/chat/discovery-playbook.ts (sdk.X.Y mentions)
 *
 * Reports per-source method sets and the diffs between them, so we can see
 * today's drift in numbers before any code changes.
 *
 * Usage:
 *   node tools-cli/audit-sdk-surface.mjs            -- print human report
 *   node tools-cli/audit-sdk-surface.mjs --json     -- print machine-readable JSON
 *   node tools-cli/audit-sdk-surface.mjs --baseline -- write today's numbers
 *                                                      to tools-cli/sdk-surface-baseline.json
 *   node tools-cli/audit-sdk-surface.mjs --check    -- compare against baseline;
 *                                                      exit 1 if any score regressed
 *
 * Per PRD 2026-05-18 D13 (baseline metrics): the baseline captures parity,
 * prompt coverage, and prompt honesty so later slices can prove they moved
 * the numbers in the right direction.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const BASELINE_PATH = resolve(here, "sdk-surface-baseline.json");

const FILES = {
  sandbox: "src/sandbox/sdk-facade.ts",
  swJob: "background/sw-job-executor.ts",
  generated: "src_data/webapi-sdk.d.ts",
  prompt: "src/chat/discovery-playbook.ts",
  promptGenerated: "src_data/workflow-sdk-reference.ts",
};

function read(rel) {
  return readFileSync(resolve(root, rel), "utf8");
}

// --- 1. parse a namespaced facade file ---------------------------------------
//
// Recognises blocks like:
//   entities: {
//     async get(...)         -> entities.get
//     async create(...)      -> entities.create
//     listChildren(...)      -> entities.listChildren
//   },
//
// Tracks brace depth so nested blocks (e.g. closures) do not leak.

function parseFacade(source) {
  const lines = source.split("\n");
  const methods = new Set();
  const namespaces = new Set();

  // Stack of { name, depth } - depth is the brace count when the namespace opened.
  const stack = [];
  let depth = 0;

  const nsOpen = /^\s+([a-zA-Z][a-zA-Z0-9]*)\s*:\s*\{\s*$/;
  // async name( OR name( as a method line inside a namespace
  const methodLine = /^\s+(?:async\s+)?([a-zA-Z][a-zA-Z0-9]*)\s*\(/;

  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, "");
    const ns = line.match(nsOpen);
    if (ns) {
      stack.push({ name: ns[1], depth });
      namespaces.add(ns[1]);
      // count braces on this line after the colon
      depth += countChar(line, "{") - countChar(line, "}");
      continue;
    }

    const opens = countChar(line, "{");
    const closes = countChar(line, "}");
    // method detection happens before depth change so we use the depth at line start
    const top = stack[stack.length - 1];
    if (top && depth === top.depth + 1) {
      const m = line.match(methodLine);
      if (m && !RESERVED.has(m[1])) {
        methods.add(`${top.name}.${m[1]}`);
      }
    }

    depth += opens - closes;
    while (stack.length > 0 && depth <= stack[stack.length - 1].depth) {
      stack.pop();
    }
  }

  return { methods, namespaces };
}

const RESERVED = new Set([
  "if", "for", "while", "switch", "return", "throw", "catch", "try",
  "function", "const", "let", "var", "new", "await", "async", "import",
  "export", "interface", "type", "class", "extends", "implements",
  "Promise", "Array", "Object", "String", "Number", "Boolean",
]);

function countChar(s, ch) {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

// --- 2. parse the generated flat WebApiSdk interface -------------------------

function parseGenerated(source) {
  const methods = new Set();
  const iface = source.match(/export interface WebApiSdk \{([\s\S]*?)\n\}/);
  if (!iface) return methods;
  const body = iface[1];
  const re = /"([a-zA-Z_][a-zA-Z0-9_]*)"\s*\(/g;
  let m;
  while ((m = re.exec(body)) !== null) methods.add(m[1]);
  return methods;
}

// --- 3. parse sdk.X.Y mentions in the workflow draft prompt block ------------

function parsePromptMentions(source) {
  // Restrict to the buildChatWorkflowDraftPrompt function body so unrelated
  // doc comments do not pollute the count.
  const fn = source.match(/export function buildChatWorkflowDraftPrompt[\s\S]*?\n\}/);
  if (!fn) return new Set();
  const body = fn[0];
  const methods = new Set();
  const re = /\bsdk\.([a-zA-Z][a-zA-Z0-9]*)\.([a-zA-Z][a-zA-Z0-9]*)/g;
  let m;
  while ((m = re.exec(body)) !== null) methods.add(`${m[1]}.${m[2]}`);
  return methods;
}

// Per PRD 2026-05-18 D15: the prompt also imports a generated SDK reference
// (src_data/workflow-sdk-reference.ts). Treat every method listed there as
// "mentioned" so the coverage score reflects the live prompt surface.
function parseGeneratedPromptMethods(source) {
  const methods = new Set();
  const block = source.match(/WORKFLOW_SDK_REFERENCE_METHODS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) return methods;
  const re = /"([a-zA-Z][a-zA-Z0-9]*)\.([a-zA-Z][a-zA-Z0-9]*)"/g;
  let m;
  while ((m = re.exec(block[1])) !== null) methods.add(`${m[1]}.${m[2]}`);
  return methods;
}

// --- 4. report ---------------------------------------------------------------

const sandbox = parseFacade(read(FILES.sandbox));
const swJob = parseFacade(read(FILES.swJob));
const generated = parseGenerated(read(FILES.generated));
const promptInline = parsePromptMentions(read(FILES.prompt));
const promptGenerated = parseGeneratedPromptMethods(read(FILES.promptGenerated));
const prompt = new Set([...promptInline, ...promptGenerated]);

const facadeUnion = new Set([...sandbox.methods, ...swJob.methods]);
const facadeIntersection = new Set([...sandbox.methods].filter((m) => swJob.methods.has(m)));

function diff(a, b) {
  return [...a].filter((x) => !b.has(x)).sort();
}

function _fmt(set) {
  return [...set].sort().join("\n  ") || "(none)";
}

const sandboxOnly = diff(sandbox.methods, swJob.methods);
const swJobOnly = diff(swJob.methods, sandbox.methods);
const promptUnknown = [...prompt].filter((m) => !facadeUnion.has(m)).sort();
const facadeUnseenByPrompt = [...facadeUnion].filter((m) => !prompt.has(m)).sort();

const lines = [];
lines.push("=".repeat(72));
lines.push("SDK SURFACE AUDIT");
lines.push("=".repeat(72));
lines.push("");

lines.push(`Namespaces (sandbox):       ${[...sandbox.namespaces].sort().join(", ")}`);
lines.push(`Namespaces (sw-job):        ${[...swJob.namespaces].sort().join(", ")}`);
lines.push("");

lines.push(`Methods - sandbox facade:   ${sandbox.methods.size}`);
lines.push(`Methods - sw-job facade:    ${swJob.methods.size}`);
lines.push(`Methods - facade union:     ${facadeUnion.size}`);
lines.push(`Methods - facade overlap:   ${facadeIntersection.size}`);
lines.push(`Methods - generated .d.ts:  ${generated.size}  (flat snake_case)`);
lines.push(`Methods - prompt mentions:  ${prompt.size}`);
lines.push("");

lines.push("-".repeat(72));
lines.push("DRIFT 1 - sandbox facade vs sw-job facade");
lines.push("-".repeat(72));
lines.push(`In sandbox but missing from sw-job (${sandboxOnly.length}):`);
lines.push("  " + (sandboxOnly.join("\n  ") || "(none)"));
lines.push(`In sw-job but missing from sandbox (${swJobOnly.length}):`);
lines.push("  " + (swJobOnly.join("\n  ") || "(none)"));
lines.push("");

lines.push("-".repeat(72));
lines.push("DRIFT 2 - prompt block vs runtime facade");
lines.push("-".repeat(72));
lines.push(`Prompt mentions that no facade exposes (${promptUnknown.length}):`);
lines.push("  " + (promptUnknown.join("\n  ") || "(none)"));
lines.push(`Facade methods the prompt never mentions (${facadeUnseenByPrompt.length}):`);
lines.push("  " + (facadeUnseenByPrompt.join("\n  ") || "(none)"));
lines.push("");

lines.push("-".repeat(72));
lines.push("DRIFT 3 - generated .d.ts vs runtime facade");
lines.push("-".repeat(72));
lines.push("Note: generated surface is flat snake_case (e.g. create_channel),");
lines.push("runtime facade is namespaced camelCase (e.g. entities.create).");
lines.push("These shapes are not interchangeable. Listing both for visibility:");
lines.push("");
lines.push(`Generated flat methods (${generated.size}):`);
lines.push("  " + ([...generated].sort().join("\n  ") || "(none)"));
lines.push("");

lines.push("-".repeat(72));
lines.push("SCORES");
lines.push("-".repeat(72));
const parityPct = facadeUnion.size === 0 ? 0 : Math.round((facadeIntersection.size / facadeUnion.size) * 100);
const promptCoverage = facadeUnion.size === 0 ? 0 : Math.round(((facadeUnion.size - facadeUnseenByPrompt.length) / facadeUnion.size) * 100);
const promptHonesty = prompt.size === 0 ? 100 : Math.round(((prompt.size - promptUnknown.length) / prompt.size) * 100);
lines.push(`Facade parity (sandbox vs sw-job):     ${parityPct}%  (${facadeIntersection.size}/${facadeUnion.size})`);
lines.push(`Prompt coverage of facade union:       ${promptCoverage}%  (${facadeUnion.size - facadeUnseenByPrompt.length}/${facadeUnion.size})`);
lines.push(`Prompt honesty (mentions that exist):  ${promptHonesty}%  (${prompt.size - promptUnknown.length}/${prompt.size})`);
lines.push("");

// --- 5. machine-readable summary + baseline / check ------------------------

const summary = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString().slice(0, 10),
  counts: {
    sandboxMethods: sandbox.methods.size,
    swJobMethods: swJob.methods.size,
    facadeUnion: facadeUnion.size,
    facadeOverlap: facadeIntersection.size,
    generatedMethods: generated.size,
    promptMentions: prompt.size,
    promptUnknown: promptUnknown.length,
    facadeUnseenByPrompt: facadeUnseenByPrompt.length,
  },
  scores: {
    facadeParityPct: parityPct,
    promptCoveragePct: promptCoverage,
    promptHonestyPct: promptHonesty,
  },
};

const flags = new Set(process.argv.slice(2));

if (flags.has("--json")) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

if (flags.has("--baseline")) {
  writeFileSync(BASELINE_PATH, JSON.stringify(summary, null, 2) + "\n", "utf8");
  console.log(`Wrote baseline to ${BASELINE_PATH}`);
  process.exit(0);
}

if (flags.has("--check")) {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`No baseline at ${BASELINE_PATH}. Run with --baseline first.`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const regressions = [];
  for (const key of Object.keys(summary.scores)) {
    if (summary.scores[key] < baseline.scores[key]) {
      regressions.push({ key, baseline: baseline.scores[key], current: summary.scores[key] });
    }
  }
  // Drift counts we explicitly want to keep at zero or decreasing.
  for (const key of ["promptUnknown", "facadeUnseenByPrompt"]) {
    if (summary.counts[key] > baseline.counts[key]) {
      regressions.push({ key, baseline: baseline.counts[key], current: summary.counts[key] });
    }
  }
  if (regressions.length > 0) {
    console.error("SDK surface check FAILED. Regressions vs baseline:");
    for (const r of regressions) {
      console.error(`  ${r.key}: ${r.baseline} -> ${r.current}`);
    }
    process.exit(1);
  }
  console.log("SDK surface check OK. No regressions vs baseline.");
  console.log(`  parity:        ${baseline.scores.facadeParityPct}% -> ${summary.scores.facadeParityPct}%`);
  console.log(`  coverage:      ${baseline.scores.promptCoveragePct}% -> ${summary.scores.promptCoveragePct}%`);
  console.log(`  honesty:       ${baseline.scores.promptHonestyPct}% -> ${summary.scores.promptHonestyPct}%`);
  process.exit(0);
}

console.log(lines.join("\n"));
