/**
 * WebMCP tool registration.
 *
 * Registers the full tool catalog (10 handwritten umbrellas + 28 per-action
 * tools generated from the Web API manifest) via
 * `navigator.modelContext.registerTool()`. Each execute callback resolves
 * credentials from chrome.storage.session, delegates to the corresponding
 * tool handler, and returns the result.
 *
 * Call registerAllTools() once when the extension initialises (side panel mount).
 * Returns false if WebMCP is not available.
 */

import "../webmcp/webmcp.d.ts";

import { TOOL_SCHEMAS } from "./tool-schemas";
import { recordWrite } from "../bridge/write-status";
import { createExecuteMap } from "../tools/internal-router";

// -- Tool definitions -----------------------------------------------------
// Schemas (name, description, inputSchema) are imported from tool-schemas.ts.
// Here we only define the execute callbacks and zip them with the schemas.

const EXECUTE_MAP = createExecuteMap({ onWriteAccepted: recordWrite });

/** Combined tool definitions (schema + execute). */
const TOOL_DEFS = TOOL_SCHEMAS.map((schema) => ({
  ...schema,
  execute: EXECUTE_MAP[schema.name],
}));

// -- Registration ---------------------------------------------------------

let registered = false;
let registrationFailed = false;

const registrationListeners = new Set<() => void>();

function notifyRegistrationListeners() {
  for (const fn of registrationListeners) fn();
}

/** Subscribe to registration state changes. Returns an unsubscribe function. */
export function subscribeRegistration(listener: () => void): () => void {
  registrationListeners.add(listener);
  return () => { registrationListeners.delete(listener); };
}

export type RegistrationState = "pending" | "registered" | "failed";

/** Get the current registration state snapshot. */
export function getRegistrationState(): RegistrationState {
  if (registered) return "registered";
  if (registrationFailed) return "failed";
  return "pending";
}

/**
 * Attempt to register all tools with the WebMCP runtime.
 * Returns true if registration succeeded or was already done.
 */
function tryRegister(): boolean {
  if (registered) return true;
  if (!navigator.modelContext) return false;

  for (const def of TOOL_DEFS) {
    navigator.modelContext.registerTool({
      name: def.name,
      title: def.title,
      description: def.description,
      inputSchema: def.inputSchema,
      ...(def.annotations ? { annotations: def.annotations } : {}),
      execute: async (input, _client) => {
        try {
          const result = await def.execute(input);
          return typeof result === "string" ? result : JSON.stringify(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return JSON.stringify({ error: msg });
        }
      },
    });
  }

  registered = true;
  console.log(`[webmcp] Registered ${TOOL_DEFS.length} tools.`);
  notifyRegistrationListeners();
  return true;
}

const RETRY_INTERVAL_MS = 2_000;
const MAX_RETRIES = 15; // 30 seconds total

/**
 * Register all tools with retry logic.
 *
 * navigator.modelContext may not be available immediately on page load
 * (Chrome injects it asynchronously). This retries every 2 seconds for
 * up to 30 seconds, and also retries on visibility changes.
 */
export function registerAllTools(): boolean {
  if (tryRegister()) return true;

  console.warn("[webmcp] navigator.modelContext not yet available -- will retry.");

  let retries = 0;
  const interval = setInterval(() => {
    retries++;
    if (tryRegister() || retries >= MAX_RETRIES) {
      clearInterval(interval);
      if (!registered) {
        console.warn("[webmcp] Gave up waiting for navigator.modelContext after retries.");
        registrationFailed = true;
        notifyRegistrationListeners();
      }
    }
  }, RETRY_INTERVAL_MS);

  // Also try when the page becomes visible (side panel may open later)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !registered) {
      tryRegister();
    }
  });

  return false;
}

/** Whether tools have been successfully registered. */
export function isRegistered(): boolean {
  return registered;
}

/** Exported for testing -- the raw definitions array. */
export { TOOL_DEFS };
