/**
 * PRD 2026-05-18 D15 parity test.
 *
 * The generated workflow SDK reference (src_data/workflow-sdk-reference.ts)
 * must enumerate every facade method exposed by src/sandbox/sdk-facade.ts.
 * If a new method is added to the facade without re-running
 * `npm run generate:sdk-reference`, this test fails so the prompt cannot
 * silently fall behind the runtime surface.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  WORKFLOW_SDK_REFERENCE,
  WORKFLOW_SDK_REFERENCE_METHODS,
} from "../../src_data/workflow-sdk-reference";

const FACADE_PATH = resolve(__dirname, "../sandbox/sdk-facade.ts");

const RESERVED = new Set([
  "if", "for", "while", "switch", "return", "throw", "catch", "try",
  "function", "const", "let", "var", "new", "await", "async", "import",
  "export", "interface", "type", "class", "extends", "implements",
  "Promise", "Array", "Object", "String", "Number", "Boolean",
]);

function countChar(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
}

function parseFacadeMethods(source: string): string[] {
  const lines = source.split("\n");
  const methods = new Set<string>();
  const stack: Array<{ name: string; depth: number }> = [];
  let depth = 0;
  const nsOpen = /^\s+([a-zA-Z][a-zA-Z0-9]*)\s*:\s*\{\s*$/;
  const methodLine = /^\s+(?:async\s+)?([a-zA-Z][a-zA-Z0-9]*)\s*\(/;
  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$/, "");
    const ns = line.match(nsOpen);
    if (ns) {
      stack.push({ name: ns[1], depth });
      depth += countChar(line, "{") - countChar(line, "}");
      continue;
    }
    const opens = countChar(line, "{");
    const closes = countChar(line, "}");
    const top = stack[stack.length - 1];
    if (top && depth === top.depth + 1) {
      const m = line.match(methodLine);
      if (m && !RESERVED.has(m[1])) methods.add(`${top.name}.${m[1]}`);
    }
    depth += opens - closes;
    while (stack.length > 0 && depth <= stack[stack.length - 1].depth) {
      stack.pop();
    }
  }
  return [...methods].sort();
}

describe("workflow SDK reference (D15)", () => {
  const facadeSource = readFileSync(FACADE_PATH, "utf8");
  const facadeMethods = parseFacadeMethods(facadeSource);

  it("enumerates every facade method", () => {
    const referenced = new Set<string>(WORKFLOW_SDK_REFERENCE_METHODS);
    const missing = facadeMethods.filter((m) => !referenced.has(m));
    expect(missing, `Run \`npm run generate:sdk-reference\` to refresh. Missing: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not reference methods absent from the facade", () => {
    const known = new Set(facadeMethods);
    const ghosts = [...WORKFLOW_SDK_REFERENCE_METHODS].filter((m) => !known.has(m));
    expect(ghosts).toEqual([]);
  });

  it("renders each method into the markdown string", () => {
    for (const key of WORKFLOW_SDK_REFERENCE_METHODS) {
      expect(WORKFLOW_SDK_REFERENCE).toContain(`sdk.${key}(`);
    }
  });

  it("documents flat transaction card params", () => {
    expect(WORKFLOW_SDK_REFERENCE).toContain("Transaction helper params are flat objects");
    expect(WORKFLOW_SDK_REFERENCE).toContain("cardNumber, cardHolder, cardExpiryMonth, cardExpiryYear, and cardCvv");
    expect(WORKFLOW_SDK_REFERENCE).toContain("Do not pass a nested card object");
  });

  it("documents listChildren array semantics", () => {
    expect(WORKFLOW_SDK_REFERENCE).toContain("sdk.entities.listChildren(parentType, parentId, childType) returns an array");
    expect(WORKFLOW_SDK_REFERENCE).toContain("the SDK aliases API channel rows where the entity ID is named channel");
  });

  it("documents the universal list contract", () => {
    expect(WORKFLOW_SDK_REFERENCE).toContain("Universal list contract");
    expect(WORKFLOW_SDK_REFERENCE).toContain("returns a plain JavaScript array");
    expect(WORKFLOW_SDK_REFERENCE).toContain("Do not read .data");
  });
});
