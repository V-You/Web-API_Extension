/**
 * Code-mode sandbox.
 *
 * Executes agent-written scripts in an AsyncFunction scope with the virtual SDK
 * and utilities injected. Scripts run in the extension's JS context (not a true
 * V8 isolate) but are scoped via AsyncFunction to prevent access to extension
 * globals beyond what is explicitly provided.
 *
 * Provides:
 *   - `sdk` -- the full SDK facade (config, entities, contacts, MAs, etc.)
 *   - `console` -- captured log/warn/error
 *   - `sleep(ms)` -- async delay
 *   - `results` -- array the script can push structured output to
 *   - `AbortSignal` via `signal` -- for cooperative cancellation
 *
 * Write operations performed through the SDK are recorded for the
 * preview/confirm bridge (build step 5).
 */

import type * as ts from "typescript";

import { buildSdkFacade, type WriteRecord } from "./sdk-facade";
import { beginScope, endScope } from "../bridge/confirm-bridge";
import type { ApiCredentials, Environment } from "../lib/types";

// -- Types ----------------------------------------------------------------

export interface SandboxInput {
  /** The script source to execute. */
  script: string;
  /** API credentials. */
  creds: ApiCredentials;
  /** Active environment. */
  env: Environment;
  /** Entity context (optional). */
  entityId?: string;
  entityType?: string;
  /** If true, validate/parse only -- do not execute. */
  dryRun?: boolean;
  /** Timeout in milliseconds (default: 10 minutes). 0 = no timeout. */
  timeoutMs?: number;
  /** Resume checkpoint from a previous interrupted run. */
  checkpoint?: unknown;
  /** Progress callback for job runner integration. */
  progressFn?: (p: { completedCalls: number; totalCalls: number; checkpoint?: unknown }) => void;
  /** External abort signal (from job runner). Overrides internal controller. */
  abortSignal?: AbortSignal;
}

export interface SandboxResult {
  status: "completed" | "error" | "timeout" | "dry_run";
  /** Value returned by the script (if any). */
  returnValue: unknown;
  /** Structured results the script pushed to the `results` array. */
  results: unknown[];
  /** Captured console output. */
  logs: LogEntry[];
  /** Write operations recorded during execution. */
  writes: WriteRecord[];
  /** Execution duration in milliseconds. */
  durationMs: number;
  /** Error message (if status is "error"). */
  error?: string;
}

export interface LogEntry {
  level: "log" | "warn" | "error";
  args: unknown[];
  timestamp: string;
}

export type SandboxCompilationResult =
  | { ok: true; jsCode: string }
  | { ok: false; error: string; issues: string[] };

type TsModule = typeof import("typescript");

// -- Parser-backed validation ---------------------------------------------

const SANDBOX_ARG_NAMES = new Set(["sdk", "console", "sleep", "results", "context", "signal", "progress"]);

const FORBIDDEN_GLOBAL_REFERENCES = new Map<string, string>([
  ["window", "window is not available inside sandbox scripts."],
  ["document", "document is not available inside sandbox scripts."],
  ["chrome", "chrome APIs are not available inside sandbox scripts."],
  ["globalThis", "globalThis access is not allowed inside sandbox scripts."],
  ["self", "self access is not allowed inside sandbox scripts."],
  ["navigator", "navigator is not available inside sandbox scripts."],
  ["location", "location is not available inside sandbox scripts."],
  ["localStorage", "localStorage is not available inside sandbox scripts."],
  ["sessionStorage", "sessionStorage is not available inside sandbox scripts."],
  ["indexedDB", "indexedDB is not available inside sandbox scripts."],
]);

const FORBIDDEN_CALLS = new Map<string, string>([
  ["eval", "eval() is not allowed inside sandbox scripts."],
  ["fetch", "Direct fetch() calls are not allowed inside sandbox scripts. Use sdk methods instead."],
  ["require", "require() is not allowed inside sandbox scripts."],
  ["importScripts", "importScripts() is not allowed inside sandbox scripts."],
  ["setTimeout", "setTimeout() is not allowed inside sandbox scripts. Use sleep(ms) instead."],
  ["setInterval", "setInterval() is not allowed inside sandbox scripts."],
  ["queueMicrotask", "queueMicrotask() is not allowed inside sandbox scripts."],
  ["postMessage", "postMessage() is not allowed inside sandbox scripts."],
  ["Function", "Function() is not allowed inside sandbox scripts."],
  ["AsyncFunction", "AsyncFunction() is not allowed inside sandbox scripts."],
]);

const FORBIDDEN_CONSTRUCTORS = new Map<string, string>([
  ["XMLHttpRequest", "XMLHttpRequest is not allowed inside sandbox scripts."],
  ["WebSocket", "WebSocket is not allowed inside sandbox scripts."],
  ["EventSource", "EventSource is not allowed inside sandbox scripts."],
  ["Worker", "Worker is not allowed inside sandbox scripts."],
  ["SharedWorker", "SharedWorker is not allowed inside sandbox scripts."],
  ["Function", "Function is not allowed inside sandbox scripts."],
  ["AsyncFunction", "AsyncFunction is not allowed inside sandbox scripts."],
]);

let typescriptPromise: Promise<TsModule> | null = null;
let typescriptRuntime: TsModule | null = null;

function getSandboxTranspileOptions(tsModule: TsModule): ts.TranspileOptions {
  return {
    fileName: "sandbox-workflow.ts",
    reportDiagnostics: true,
    compilerOptions: {
      target: tsModule.ScriptTarget.ES2022,
      module: tsModule.ModuleKind.ESNext,
      isolatedModules: true,
      noEmitHelpers: true,
      useDefineForClassFields: false,
    },
  };
}

async function getTypeScriptRuntime(): Promise<TsModule> {
  if (!typescriptPromise) {
    typescriptPromise = import("typescript").then((module) => {
      typescriptRuntime = module;
      return module;
    });
  }

  return typescriptPromise;
}

function getTypeScript(): TsModule {
  if (!typescriptRuntime) {
    throw new Error("TypeScript runtime has not been loaded.");
  }

  return typescriptRuntime;
}

function addBindingName(name: ts.BindingName, names: Set<string>) {
  const tsModule = getTypeScript();

  if (tsModule.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (tsModule.isOmittedExpression(element)) continue;
    addBindingName(element.name, names);
  }
}

function collectDeclaredNames(source: ts.SourceFile): Set<string> {
  const tsModule = getTypeScript();
  const names = new Set<string>(SANDBOX_ARG_NAMES);

  const visit = (node: ts.Node) => {
    if (tsModule.isVariableDeclaration(node)) {
      addBindingName(node.name, names);
    } else if (tsModule.isParameter(node)) {
      addBindingName(node.name, names);
    } else if (tsModule.isFunctionDeclaration(node) && node.name) {
      names.add(node.name.text);
    } else if (tsModule.isClassDeclaration(node) && node.name) {
      names.add(node.name.text);
    } else if (tsModule.isTypeAliasDeclaration(node) || tsModule.isInterfaceDeclaration(node) || tsModule.isEnumDeclaration(node)) {
      names.add(node.name.text);
    }

    tsModule.forEachChild(node, visit);
  };

  visit(source);
  return names;
}

function isTypeOnlyIdentifier(node: ts.Identifier): boolean {
  const tsModule = getTypeScript();
  const parent = node.parent;

  return (
    (tsModule.isTypeReferenceNode(parent) && parent.typeName === node) ||
    tsModule.isExpressionWithTypeArguments(parent) ||
    tsModule.isTypeAliasDeclaration(parent) ||
    tsModule.isInterfaceDeclaration(parent) ||
    tsModule.isHeritageClause(parent) ||
    tsModule.isTypeQueryNode(parent) ||
    tsModule.isQualifiedName(parent)
  );
}

function isNonRuntimeIdentifierPosition(node: ts.Identifier): boolean {
  const tsModule = getTypeScript();
  const parent = node.parent;

  return (
    (tsModule.isPropertyAccessExpression(parent) && parent.name === node) ||
    (tsModule.isPropertyAssignment(parent) && parent.name === node) ||
    (tsModule.isMethodDeclaration(parent) && parent.name === node) ||
    (tsModule.isMethodSignature(parent) && parent.name === node) ||
    (tsModule.isPropertyDeclaration(parent) && parent.name === node) ||
    (tsModule.isPropertySignature(parent) && parent.name === node) ||
    (tsModule.isVariableDeclaration(parent) && parent.name === node) ||
    (tsModule.isParameter(parent) && parent.name === node) ||
    (tsModule.isFunctionDeclaration(parent) && parent.name === node) ||
    (tsModule.isClassDeclaration(parent) && parent.name === node) ||
    (tsModule.isBindingElement(parent) && parent.name === node) ||
    isTypeOnlyIdentifier(node)
  );
}

function formatNodeIssue(source: ts.SourceFile, node: ts.Node, message: string): string {
  const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `Line ${line + 1}, col ${character + 1}: ${message}`;
}

function formatDiagnostic(diagnostic: ts.Diagnostic, fallbackSource?: ts.SourceFile): string {
  const tsModule = getTypeScript();
  const message = tsModule.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const source = diagnostic.file ?? fallbackSource;

  if (!source || diagnostic.start === undefined) {
    return message;
  }

  const { line, character } = source.getLineAndCharacterOfPosition(diagnostic.start);
  return `Line ${line + 1}, col ${character + 1}: ${message}`;
}

function buildCompilationError(issues: string[]): string {
  const visible = issues.slice(0, 8);
  const remaining = issues.length - visible.length;
  const lines = ["Sandbox script validation failed:", ...visible.map((issue) => `- ${issue}`)];

  if (remaining > 0) {
    lines.push(`- ${remaining} more issue(s) omitted`);
  }

  return lines.join("\n");
}

function collectSandboxIssues(source: ts.SourceFile): string[] {
  const tsModule = getTypeScript();
  const declaredNames = collectDeclaredNames(source);
  const issues = new Map<string, string>();

  const addIssue = (key: string, node: ts.Node, message: string) => {
    if (!issues.has(key)) {
      issues.set(key, formatNodeIssue(source, node, message));
    }
  };

  const visit = (node: ts.Node) => {
    if (tsModule.isImportDeclaration(node) || tsModule.isImportEqualsDeclaration(node)) {
      addIssue("module-import", node, "Module imports are not allowed in sandbox scripts.");
    } else if (tsModule.isExportAssignment(node) || tsModule.isExportDeclaration(node)) {
      addIssue("module-export", node, "Module exports are not allowed in sandbox scripts.");
    } else if (tsModule.isWithStatement(node)) {
      addIssue("with-statement", node, "with statements are not allowed in sandbox scripts.");
    } else if (tsModule.isDebuggerStatement(node)) {
      addIssue("debugger", node, "debugger statements are not allowed in sandbox scripts.");
    } else if (tsModule.isMetaProperty(node) && node.keywordToken === tsModule.SyntaxKind.ImportKeyword) {
      addIssue("import-meta", node, "import.meta is not allowed in sandbox scripts.");
    } else if (tsModule.isCallExpression(node)) {
      if (node.expression.kind === tsModule.SyntaxKind.ImportKeyword) {
        addIssue("dynamic-import", node, "Dynamic import() is not allowed in sandbox scripts.");
      } else if (tsModule.isIdentifier(node.expression)) {
        const callee = node.expression.text;
        const message = FORBIDDEN_CALLS.get(callee);
        if (message && !declaredNames.has(callee)) {
          addIssue(`call:${callee}`, node, message);
        }
      }
    } else if (tsModule.isNewExpression(node) && tsModule.isIdentifier(node.expression)) {
      const ctor = node.expression.text;
      const message = FORBIDDEN_CONSTRUCTORS.get(ctor);
      if (message && !declaredNames.has(ctor)) {
        addIssue(`new:${ctor}`, node, message);
      }
    } else if (tsModule.isIdentifier(node)) {
      const message = FORBIDDEN_GLOBAL_REFERENCES.get(node.text);
      if (message && !declaredNames.has(node.text) && !isNonRuntimeIdentifierPosition(node)) {
        addIssue(`global:${node.text}`, node, message);
      }
    }

    tsModule.forEachChild(node, visit);
  };

  visit(source);
  return [...issues.values()];
}

/**
 * Compile a sandbox script using the TypeScript parser and transpiler.
 * This replaces the earlier regex-based TypeScript stripping path.
 */
export async function compileSandboxScript(script: string): Promise<SandboxCompilationResult> {
  if (!script.trim()) {
    return {
      ok: false,
      error: "Sandbox script validation failed:\n- Script is empty.",
      issues: ["Script is empty."],
    };
  }

  const tsModule = await getTypeScriptRuntime();
  const transpileOptions = getSandboxTranspileOptions(tsModule);

  const source = tsModule.createSourceFile(
    transpileOptions.fileName ?? "sandbox-workflow.ts",
    script,
    tsModule.ScriptTarget.ES2022,
    true,
    tsModule.ScriptKind.TS,
  );

  const issues = [
    ...collectSandboxIssues(source),
  ];

  if (issues.length > 0) {
    return {
      ok: false,
      error: buildCompilationError(issues),
      issues,
    };
  }

  const transpiled = tsModule.transpileModule(script, transpileOptions);
  const diagnostics = (transpiled.diagnostics ?? [])
    .filter((diagnostic) => diagnostic.category === tsModule.DiagnosticCategory.Error)
    .map((diagnostic) => formatDiagnostic(diagnostic, source));

  if (diagnostics.length > 0) {
    return {
      ok: false,
      error: buildCompilationError(diagnostics),
      issues: diagnostics,
    };
  }

  return { ok: true, jsCode: transpiled.outputText };
}

// -- Sandbox execution ----------------------------------------------------

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// AsyncFunction constructor
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/**
 * Execute a script in the sandbox.
 */
export async function runSandbox(input: SandboxInput): Promise<SandboxResult> {
  const startTime = Date.now();
  const logs: LogEntry[] = [];
  const results: unknown[] = [];
  const writes: WriteRecord[] = [];
  const timeoutMs = input.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : input.timeoutMs;

  const compiled = await compileSandboxScript(input.script);
  if (!compiled.ok) {
    return {
      status: "error",
      returnValue: null,
      results: [],
      logs: [],
      writes: [],
      durationMs: Date.now() - startTime,
      error: compiled.error,
    };
  }

  const jsCode = compiled.jsCode;

  // Dry run: validate and transpile only -- do not execute.
  if (input.dryRun) {
    try {
      new AsyncFunction("sdk", "console", "sleep", "results", "context", "signal", "progress", jsCode);
      return {
        status: "dry_run",
        returnValue: null,
        results: [],
        logs: [],
        writes: [],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        status: "error",
        returnValue: null,
        results: [],
        logs: [],
        writes: [],
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Build the SDK facade
  const sdk = buildSdkFacade(input.creds, input.env, writes);

  // Captured console
  const consoleProxy = {
    log: (...args: unknown[]) => logs.push({ level: "log", args, timestamp: new Date().toISOString() }),
    warn: (...args: unknown[]) => logs.push({ level: "warn", args, timestamp: new Date().toISOString() }),
    error: (...args: unknown[]) => logs.push({ level: "error", args, timestamp: new Date().toISOString() }),
  };

  // Abort controller for timeout and cancellation.
  // When the job runner provides an external signal, link it.
  const controller = new AbortController();
  const { signal } = controller;
  if (input.abortSignal) {
    if (input.abortSignal.aborted) { controller.abort(); }
    else { input.abortSignal.addEventListener("abort", () => controller.abort(), { once: true }); }
  }

  // Sleep utility respecting abort signal
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });

  // Progress reporter injected into the script as `progress(completed, total, cp)`
  const progress = (completedCalls: number, totalCalls: number, checkpoint?: unknown) => {
    input.progressFn?.({ completedCalls, totalCalls, checkpoint });
  };

  // Context object with entity info and checkpoint (if resuming)
  const context = {
    entityId: input.entityId ?? null,
    entityType: input.entityType ?? null,
    env: input.env,
    checkpoint: input.checkpoint ?? null,
  };

  // Build and execute the function
  const scopeId = `sandbox-${Date.now()}`;
  beginScope(scopeId);
  try {
    const fn = new AsyncFunction(
      "sdk",
      "console",
      "sleep",
      "results",
      "context",
      "signal",
      "progress",
      jsCode
    );

    // Race between execution and timeout (if timeoutMs is set)
    const execPromise = fn(sdk, consoleProxy, sleep, results, context, signal, progress);

    let returnValue: unknown;
    if (timeoutMs > 0) {
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          controller.abort();
          reject(new DOMException("Script execution timed out", "TimeoutError"));
        }, timeoutMs);
        execPromise.then(() => clearTimeout(timer), () => clearTimeout(timer));
      });
      returnValue = await Promise.race([execPromise, timeoutPromise]);
    } else {
      returnValue = await execPromise;
    }

    return {
      status: "completed",
      returnValue: returnValue ?? null,
      results,
      logs,
      writes,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return {
        status: "timeout",
        returnValue: null,
        results,
        logs,
        writes,
        durationMs: Date.now() - startTime,
        error: `Script timed out after ${Math.round(timeoutMs / 1000)}s`,
      };
    }

    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        status: "timeout",
        returnValue: null,
        results,
        logs,
        writes,
        durationMs: Date.now() - startTime,
        error: "Script was cancelled",
      };
    }

    return {
      status: "error",
      returnValue: null,
      results,
      logs,
      writes,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    endScope();
  }
}
