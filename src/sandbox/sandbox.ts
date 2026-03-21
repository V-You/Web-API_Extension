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

import { buildSdkFacade, type WriteRecord } from "./sdk-facade";
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
  /** Timeout in milliseconds (default: 10 minutes). */
  timeoutMs?: number;
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

// -- Strip TS annotations -------------------------------------------------

/**
 * Lightweight strip of common TypeScript-only syntax so the script can
 * be executed as plain JavaScript. Handles:
 *   - Type annotations on variables/params (: Type)
 *   - Type assertions (as Type)
 *   - Interface/type declarations (removed entirely)
 *   - Generic brackets on function calls
 *
 * This is intentionally simple -- not a full TS parser. The agent's scripts
 * are expected to be simple imperative code, not complex TS.
 */
function stripTypeAnnotations(src: string): string {
  // Remove interface/type alias declarations (entire lines)
  let code = src.replace(/^[ \t]*(export\s+)?(interface|type)\s+\w[\s\S]*?^[ \t]*}/gm, "");

  // Remove `as Type` assertions (simple single-word or generic types)
  code = code.replace(/\bas\s+\w+(\[\])?(\s*[<][^>]*[>])?\b/g, "");

  // Remove parameter/variable type annotations (: Type) but not object keys
  // Match `: Type` after identifiers in function params and variable declarations
  // Careful not to strip ternary operators or object literal colons
  code = code.replace(
    /(\w)\s*:\s*(string|number|boolean|any|unknown|void|never|null|undefined|Record<[^>]+>|Array<[^>]+>|\w+\[\]|\w+)(\s*[,)=;\n])/g,
    "$1$3"
  );

  // Remove generic type parameters on function calls: fn<Type>(
  code = code.replace(/(\w+)\s*<[^>]+>\s*\(/g, "$1(");

  return code;
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
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Build the SDK facade
  const sdk = buildSdkFacade(input.creds, input.env, writes);

  // Captured console
  const consoleProxy = {
    log: (...args: unknown[]) => logs.push({ level: "log", args, timestamp: new Date().toISOString() }),
    warn: (...args: unknown[]) => logs.push({ level: "warn", args, timestamp: new Date().toISOString() }),
    error: (...args: unknown[]) => logs.push({ level: "error", args, timestamp: new Date().toISOString() }),
  };

  // Abort controller for timeout and cancellation
  const controller = new AbortController();
  const { signal } = controller;

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

  // Context object with entity info (if provided)
  const context = {
    entityId: input.entityId ?? null,
    entityType: input.entityType ?? null,
    env: input.env,
  };

  // Strip TS annotations
  const jsCode = stripTypeAnnotations(input.script);

  // Dry run: parse only, do not execute
  if (input.dryRun) {
    try {
      // Attempt to construct the function to validate syntax
      new AsyncFunction("sdk", "console", "sleep", "results", "context", "signal", jsCode);
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

  // Build and execute the function
  try {
    const fn = new AsyncFunction(
      "sdk",
      "console",
      "sleep",
      "results",
      "context",
      "signal",
      jsCode
    );

    // Race between execution and timeout
    const execPromise = fn(sdk, consoleProxy, sleep, results, context, signal);
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new DOMException("Script execution timed out", "TimeoutError"));
      }, timeoutMs);
      // Allow GC if exec finishes first
      execPromise.then(() => clearTimeout(timer), () => clearTimeout(timer));
    });

    const returnValue = await Promise.race([execPromise, timeoutPromise]);

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
  }
}
