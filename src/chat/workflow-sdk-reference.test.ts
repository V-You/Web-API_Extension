/**
 * PRD 2026-05-18 D15 parity test.
 *
 * The generated workflow SDK reference (src_data/workflow-sdk-reference.ts)
 * must enumerate every method declared in src_data/workflow-sdk-registry.json.
 * If the canonical registry changes without re-running
 * `npm run generate:sdk-reference`, this test fails so the prompt/preflight
 * surface cannot silently fall behind the registry.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  WORKFLOW_SDK_REFERENCE,
  WORKFLOW_SDK_REFERENCE_METHODS,
} from "../../src_data/workflow-sdk-reference";
import { WORKFLOW_SDK_METHODS } from "../sdk/workflow-registry";
import { createWorkflowSdk } from "../sdk/workflow-sdk";

const FACADE_PATH = resolve(__dirname, "../sandbox/sdk-facade.ts");
const SW_JOB_EXECUTOR_PATH = resolve(__dirname, "../../background/sw-job-executor.ts");

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

function runtimeMethodKeys(sdk: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(sdk)) {
    if (typeof value === "function") {
      out.push(key);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    for (const method of Object.keys(value)) {
      if (typeof (value as Record<string, unknown>)[method] === "function") out.push(`${key}.${method}`);
    }
  }
  return out.sort();
}

describe("workflow SDK reference (D15)", () => {
  const facadeSource = readFileSync(FACADE_PATH, "utf8");
  const swJobSource = readFileSync(SW_JOB_EXECUTOR_PATH, "utf8");
  const facadeMethods = parseFacadeMethods(facadeSource);
  const swJobMethods = parseFacadeMethods(swJobSource);
  const registryMethods = [...WORKFLOW_SDK_METHODS].sort();

  it("enumerates every registry method", () => {
    expect([...WORKFLOW_SDK_REFERENCE_METHODS].sort()).toEqual(registryMethods);
  });

  it("keeps the registry as a superset of async facade methods during migration", () => {
    const known = new Set<string>(WORKFLOW_SDK_REFERENCE_METHODS);
    const missing = [...new Set([...facadeMethods, ...swJobMethods])].filter((m) => !known.has(m)).sort();
    expect(missing, `Add missing methods to src_data/workflow-sdk-registry.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("requires both host wrappers to route through createWorkflowSdk so the registry equals the runtime surface", () => {
    // After Step 2 of PRD 2026-05-20, buildSdkFacade and buildSwSdk are thin
    // wrappers over createWorkflowSdk. They must not declare any standalone
    // method literals; if either grows a hand-written method again the
    // generated registry will silently drift.
    expect(facadeMethods, "src/sandbox/sdk-facade.ts must not declare standalone SDK methods; route through createWorkflowSdk.").toEqual([]);
    expect(swJobMethods, "background/sw-job-executor.ts must not declare standalone SDK methods; route through createWorkflowSdk.").toEqual([]);
  });

  it("matches createWorkflowSdk runtime method keys", () => {
    const sdk = createWorkflowSdk({
      creds: { username: "u", password: "p" } as never,
      env: "uat" as never,
      host: {
        entityWriteTransport: "typedTool",
        contactWriteTransport: "typedTool",
        merchantAccountWriteTransport: "typedTool",
        beforeSettingsWrite: async () => undefined,
        beforeEntityWrite: async () => undefined,
        beforeContactWrite: async () => undefined,
        beforeMerchantAccountWrite: async () => undefined,
        recordTransactionWrite: () => undefined,
      },
    }) as Record<string, unknown>;
    expect(runtimeMethodKeys(sdk)).toEqual(registryMethods);
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
