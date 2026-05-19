#!/usr/bin/env node
/**
 * generate-sdk-reference.mjs
 *
 * Per PRD 2026-05-18 D15 - Generate the prompt SDK reference, do not
 * maintain it by hand.
 *
 * Parses the namespaced runtime facade declared in src/sandbox/sdk-facade.ts
 * (the single source of truth for the SDK surface, per D14) and emits a
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
const SOURCE = resolve(ROOT, "src/sandbox/sdk-facade.ts");
const OUT = resolve(ROOT, "src_data/workflow-sdk-reference.ts");

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

/**
 * Walk the facade source and capture, per namespace, the method name and
 * a simplified positional signature derived from the source argument list.
 *
 * Limits:
 *   - Methods declared as `(...args: unknown[])` (overloaded write
 *     dispatchers in merchantAccounts) are emitted with `(...args)` and
 *     marked as overloaded so the caller can annotate them.
 */
function parseFacade(source) {
  const lines = source.split("\n");
  const namespaces = new Map(); // name -> array of { method, args, overloaded }
  const order = [];

  // Stack of { name, depth }
  const stack = [];
  let depth = 0;

  const nsOpen = /^\s+([a-zA-Z][a-zA-Z0-9]*)\s*:\s*\{\s*$/;
  const methodLine = /^\s+(?:async\s+)?([a-zA-Z][a-zA-Z0-9]*)\s*\(([^)]*)\)/;

  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, "");
    const ns = line.match(nsOpen);
    if (ns) {
      if (!namespaces.has(ns[1])) {
        namespaces.set(ns[1], []);
        order.push(ns[1]);
      }
      stack.push({ name: ns[1], depth });
      depth += countChar(line, "{") - countChar(line, "}");
      continue;
    }

    const opens = countChar(line, "{");
    const closes = countChar(line, "}");
    const top = stack[stack.length - 1];
    if (top && depth === top.depth + 1) {
      const m = line.match(methodLine);
      if (m && !RESERVED.has(m[1])) {
        const method = m[1];
        const rawArgs = m[2].trim();
        const overloaded = rawArgs.startsWith("...args");
        const args = overloaded ? "...args" : stripArgTypes(rawArgs);
        // Skip duplicates (e.g. two separate "list" declarations - keep first).
        if (!namespaces.get(top.name).some((e) => e.method === method)) {
          namespaces.get(top.name).push({ method, args, overloaded });
        }
      }
    }

    depth += opens - closes;
    while (stack.length > 0 && depth <= stack[stack.length - 1].depth) {
      stack.pop();
    }
  }

  return { order, namespaces };
}

/**
 * "entityType: EntityType, entityId: string, settings: Record<string, unknown>"
 *   -> "entityType, entityId, settings"
 *
 * "scope?: \"owned\" | \"attached\""
 *   -> "scope?"
 *
 * Keeps optional markers and default-arg presence; drops type annotations.
 */
function stripArgTypes(input) {
  if (!input) return "";
  const out = [];
  // Split on commas at depth 0 (so generics like Record<string, unknown> stay).
  let depthA = 0, depthC = 0, depthS = 0, current = "";
  for (const ch of input) {
    if (ch === "<") depthA++;
    else if (ch === ">") depthA--;
    else if (ch === "(") depthC++;
    else if (ch === ")") depthC--;
    else if (ch === "{") depthS++;
    else if (ch === "}") depthS--;
    if (ch === "," && depthA === 0 && depthC === 0 && depthS === 0) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current);
  return out
    .map((part) => {
      // Drop default: "foo = bar"
      const eq = part.indexOf("=");
      const head = eq >= 0 ? part.slice(0, eq) : part;
      // Drop annotation: "foo?: SomeType" -> "foo?"
      const colon = head.indexOf(":");
      const name = (colon >= 0 ? head.slice(0, colon) : head).trim();
      return name;
    })
    .filter(Boolean)
    .join(", ");
}

/** Build the markdown reference string injected into the workflow prompt. */
function renderMarkdown(parsed) {
  const lines = [];
  lines.push("Authoritative workflow SDK reference (generated from src/sandbox/sdk-facade.ts).");
  lines.push("Do not call namespaces or methods that are not listed here. If you need a capability that is missing, return a workflow draft that throws a clear error explaining the missing SDK surface instead of inventing a method.");
  lines.push("");
  for (const ns of parsed.order) {
    const methods = parsed.namespaces.get(ns) || [];
    if (methods.length === 0) continue;
    lines.push(`sdk.${ns}:`);
    for (const entry of methods) {
      const suffix = entry.overloaded ? "  // overloaded; see behavioural rules above for accepted shapes" : "";
      lines.push(`  - sdk.${ns}.${entry.method}(${entry.args})${suffix}`);
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
      out.push(`${ns}.${entry.method}`);
    }
  }
  return out.sort();
}

function renderModule(markdown, methods) {
  const escaped = markdown.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const methodsLiteral = methods.map((m) => `  "${m}"`).join(",\n");
  return [
    "// GENERATED FILE - do not edit by hand.",
    "// Source: src/sandbox/sdk-facade.ts",
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
  const source = readFileSync(SOURCE, "utf8");
  const parsed = parseFacade(source);
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
    console.log("workflow-sdk-reference.ts is in sync with sdk-facade.ts.");
    process.exit(0);
  }

  writeFileSync(OUT, next, "utf8");
  console.log(`Wrote ${OUT} (${methods.length} methods across ${parsed.order.length} namespaces).`);
}

main();
