/**
 * Main-world content script -- WebMCP tool registration.
 *
 * Runs in the page's main world (`world: "MAIN"` in manifest), making
 * registered tools visible to browser-native AI assistants (Gemini, etc.).
 *
 * Execute callbacks delegate to the isolated-world bridge via postMessage.
 * Credentials never leave the isolated world.
 */

import "../src/webmcp/webmcp.d.ts";
import { TOOL_SCHEMAS } from "../src/webmcp/tool-schemas";

// -- Pending call tracking ------------------------------------------------

interface PendingCall {
  resolve: (result: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingCall>();

const CALL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

// -- Result listener (isolated world -> main world) -----------------------

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== "webmcp:tool-result") return;

  const callId = data.callId as string;
  const entry = pending.get(callId);
  if (!entry) return;

  clearTimeout(entry.timer);
  pending.delete(callId);

  if (data.error) {
    entry.reject(new Error(data.error));
  } else {
    entry.resolve(data.result ?? "{}");
  }
});

// -- Tool registration ----------------------------------------------------

let registered = false;

function tryRegister(): boolean {
  if (registered) return true;
  if (!navigator.modelContext) return false;

  for (const schema of TOOL_SCHEMAS) {
    navigator.modelContext.registerTool({
      name: schema.name,
      description: schema.description,
      inputSchema: schema.inputSchema,
      execute: (params) => {
        const callId = crypto.randomUUID();

        return new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(callId);
            reject(new Error(`Tool call ${schema.name} timed out after ${CALL_TIMEOUT_MS / 1000}s.`));
          }, CALL_TIMEOUT_MS);

          pending.set(callId, { resolve, reject, timer });

          window.postMessage(
            {
              type: "webmcp:tool-call",
              callId,
              tool: schema.name,
              params,
            },
            "*",
          );
        });
      },
    });
  }

  registered = true;
  console.log(`[webmcp-main] Registered ${TOOL_SCHEMAS.length} tools in main world.`);
  return true;
}

// -- Retry logic ----------------------------------------------------------

const RETRY_INTERVAL_MS = 2_000;
const MAX_RETRIES = 15;

if (!tryRegister()) {
  console.warn("[webmcp-main] navigator.modelContext not yet available -- will retry.");

  let retries = 0;
  const interval = setInterval(() => {
    retries++;
    if (tryRegister() || retries >= MAX_RETRIES) {
      clearInterval(interval);
      if (!registered) {
        console.warn("[webmcp-main] Gave up waiting for navigator.modelContext after retries.");
      }
    }
  }, RETRY_INTERVAL_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !registered) {
      tryRegister();
    }
  });
}
