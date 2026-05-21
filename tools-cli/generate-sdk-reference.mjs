#!/usr/bin/env node
/**
 * generate-sdk-reference.mjs
 *
 * Per PRD 2026-05-18 D15 - Generate the prompt SDK reference, do not
 * maintain it by hand.
 *
 * Reads the canonical workflow SDK registry in src_data/workflow-sdk-registry.json
 * (the shared source of truth for both workflow lifecycles) and emits a
 * generated TypeScript module that exports:
 *
 *   - WORKFLOW_SDK_REFERENCE - a markdown reference string consumed by
 *     src/chat/discovery-playbook.ts to inject an authoritative method
 *     list into the workflow draft prompt.
 *   - WORKFLOW_SDK_REFERENCE_METHODS - the flat list of `${ns}.${method}`
 *     identifiers; used by tests to assert generation parity.
 *
 * Usage:
 *   node tools-cli/generate-sdk-reference.mjs           write the file
 *   node tools-cli/generate-sdk-reference.mjs --check   exit 1 if regen
 *                                                       would change the
 *                                                       committed file
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const REGISTRY = resolve(ROOT, "src_data/workflow-sdk-registry.json");
const OUT = resolve(ROOT, "src_data/workflow-sdk-reference.ts");

function normalizeRegistry(raw) {
  return {
    order: raw.namespaces.map((ns) => ns.name),
    namespaces: new Map(raw.namespaces.map((ns) => [ns.name, ns.methods])),
    topLevelMethods: raw.topLevelMethods ?? [],
  };
}

/** Build the markdown reference string injected into the workflow prompt. */
function renderMarkdown(parsed) {
  const lines = [];
  lines.push("Authoritative workflow SDK reference (generated from src_data/workflow-sdk-registry.json).");
  lines.push("Do not call namespaces or methods that are not listed here. If you need a capability that is missing, return a workflow draft that throws a clear error explaining the missing SDK surface instead of inventing a method.");
  lines.push("Transaction helper params are flat objects. For card data, use top-level fields cardNumber, cardHolder, cardExpiryMonth, cardExpiryYear, and cardCvv. Do not pass a nested card object such as card: { holder: ... }.");
  lines.push("Universal list contract: every sdk.*.list*, sdk.*.search, and sdk.entities.listChildren method returns a plain JavaScript array of row objects. Call .map / .filter / .slice / .find directly on the returned value. Do not read .data, .items, .ownedContacts, .merchantAccounts, or any other wrapper key off the return value - normalization already happened inside the SDK.");
  lines.push("sdk.entities.listChildren(parentType, parentId, childType) returns an array. Channel rows expose a stable id field; the SDK aliases API channel rows where the entity ID is named channel.");
  lines.push("");
  for (const ns of parsed.order) {
    const methods = parsed.namespaces.get(ns) || [];
    if (methods.length === 0) continue;
    lines.push(`sdk.${ns}:`);
    for (const entry of methods) {
      const suffix = entry.overloaded ? "  // overloaded; see behavioural rules above for accepted shapes" : "";
      lines.push(`  - sdk.${ns}.${entry.name}(${entry.args})${suffix}`);
    }
    lines.push("");
  }
  if (parsed.topLevelMethods.length > 0) {
    lines.push("sdk top-level helpers:");
    for (const entry of parsed.topLevelMethods) {
      lines.push(`  - sdk.${entry.name}(${entry.args})`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

/** Build the flat list used by tests to assert generator parity. */
function flatMethods(parsed) {
  const out = [];
  for (const ns of parsed.order) {
    for (const entry of parsed.namespaces.get(ns) || []) {
      out.push(`${ns}.${entry.name}`);
    }
  }
  for (const entry of parsed.topLevelMethods) out.push(entry.name);
  return out.sort();
}

function renderModule(markdown, methods) {
  const escaped = markdown.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const methodsLiteral = methods.map((m) => `  "${m}"`).join(",\n");
  return [
    "// GENERATED FILE - do not edit by hand.",
    "// Source: src_data/workflow-sdk-registry.json",
    "// Regenerate with: npm run generate:sdk-reference",
    "// See PRD 2026-05-18 D15.",
    "",
    "export const WORKFLOW_SDK_REFERENCE = `" + escaped + "`;",
    "",
    "export const WORKFLOW_SDK_REFERENCE_METHODS = [",
    methodsLiteral,
    "] as const;",
    "",
  ].join("\n");
}

function main() {
  const flags = new Set(process.argv.slice(2));
  const parsed = normalizeRegistry(JSON.parse(readFileSync(REGISTRY, "utf8")));
  const markdown = renderMarkdown(parsed);
  const methods = flatMethods(parsed);
  const next = renderModule(markdown, methods);

  if (flags.has("--check")) {
    if (!existsSync(OUT)) {
      console.error(`Missing generated file ${OUT}. Run \`npm run generate:sdk-reference\`.`);
      process.exit(1);
    }
    const current = readFileSync(OUT, "utf8");
    if (current !== next) {
      console.error("workflow-sdk-reference.ts is out of date.");
      console.error("Run `npm run generate:sdk-reference` and commit the result.");
      process.exit(1);
    }
    console.log("workflow-sdk-reference.ts is in sync with workflow-sdk-registry.json.");
    process.exit(0);
  }

  writeFileSync(OUT, next, "utf8");
  console.log(`Wrote ${OUT} (${methods.length} methods across ${parsed.order.length} namespaces).`);
}

main();
