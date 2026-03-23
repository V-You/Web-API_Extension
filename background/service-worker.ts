/**
 * Background service worker.
 *
 * Responsibilities:
 *   1. Open the side panel when the extension action icon is clicked.
 *   2. Relay API requests from the side panel (message passing).
 *   3. Detect tab closure to signal job pause.
 *   4. On startup, mark any "running" jobs as "paused" (browser restart recovery).
 *   5. Execute long-running jobs (per PRD 8.1).
 */

import { swStartJob, swPauseJob, swCancelJob, swCancelJobById, swGetActiveJobId, type SwJobStartInput } from "./sw-job-executor";
import { TOOL_SCHEMAS } from "../src/webmcp/tool-schemas";
import type { ToolSchema } from "../src/webmcp/tool-schemas";

// -- Side panel activation ------------------------------------------------

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(console.error);
} else {
  // Keep worker alive even when sidePanel is unavailable on this Chrome build.
  console.warn("[sw] sidePanel API not available.");
}

// -- Browser restart recovery ---------------------------------------------
// If the browser restarted while a job was running, mark it as paused
// so the side panel can offer to resume.

if (chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    const result = await chrome.storage.local.get("jobs");
    const jobs = (result.jobs ?? []) as Array<{ id: string; state: string; pausedAt?: string }>;
    let changed = false;
    for (const job of jobs) {
      if (job.state === "running" || job.state === "resumed") {
        job.state = "paused";
        job.pausedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) {
      await chrome.storage.local.set({ jobs });
    }
  });
}

// -- Tab removal detection ------------------------------------------------
// Per PRD 8.2: if the BIP tab is closed, the job should pause.
// The side panel listens for this message to trigger pauseJob().

if (chrome.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    // Auto-pause the active job if a tab closes (per PRD 8.2)
    if (swGetActiveJobId()) {
      console.log("[sw] tab closed, pausing active job");
      swPauseJob();
    }
    // Also notify the side panel (for UI update)
    chrome.runtime.sendMessage({ type: "tab_closed", tabId }).catch(() => {
      // Side panel may not be open -- ignore
    });
  });
}

// -- Message handling -----------------------------------------------------

export interface ApiMessage {
  type: "api_request";
  payload: {
    env: "uat" | "prod";
    method: "GET" | "POST" | "DELETE";
    path: string;
    params?: Record<string, string>;
  };
}

export interface JobControlMessage {
  type: "job_pause" | "job_cancel" | "job_status";
  jobId?: string;
}

export type ServiceWorkerMessage = ApiMessage | JobControlMessage | { type: string; [key: string]: unknown };

export interface ApiMessageResponse {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

chrome.runtime.onMessage.addListener(
  (
    message: ServiceWorkerMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (message.type === "api_request") {
      handleApiRequest((message as ApiMessage).payload)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            ok: false,
            status: 0,
            data: null,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      return true;
    }

    // -- Job execution (per PRD 8.1: jobs execute in service worker) ------

    if (message.type === "job_start") {
      swStartJob(message.payload as SwJobStartInput)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({ ok: false, jobId: "", error: err instanceof Error ? err.message : String(err) })
        );
      return true;
    }

    if (message.type === "job_pause") {
      swPauseJob().then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "job_cancel") {
      const cancelId = message.jobId as string | undefined;
      (cancelId ? swCancelJobById(cancelId) : swCancelJob())
        .then(() => sendResponse({ ok: true }));
      return true;
    }

    if (message.type === "job_resume") {
      swStartJob(message.payload as SwJobStartInput)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({ ok: false, jobId: "", error: err instanceof Error ? err.message : String(err) })
        );
      return true;
    }

    if (message.type === "job_status") {
      sendResponse({ activeJobId: swGetActiveJobId() });
      return false;
    }

    // -- Main-world WebMCP tool registration (bypasses page CSP) ----------

    if (message.type === "webmcp:inject-main") {
      const tabId = _sender.tab?.id;
      if (!tabId) {
        sendResponse({ ok: false, error: "No tab ID" });
        return false;
      }
      chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: registerToolsInMainWorld,
        args: [TOOL_SCHEMAS],
      })
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: String(err) }));
      return true;
    }
  }
);

async function handleApiRequest(
  payload: ApiMessage["payload"]
): Promise<ApiMessageResponse> {
  // Fetch credentials from session storage
  const sessionKey = `session:${payload.env}`;
  const result = await chrome.storage.session.get(sessionKey);
  const creds = result[sessionKey] as
    | { baseUrl: string; username: string; password: string }
    | undefined;

  if (!creds) {
    return { ok: false, status: 0, data: null, error: "Session not unlocked" };
  }

  const url = `${creds.baseUrl}${payload.path}`;
  const headers: Record<string, string> = {
    credentials: `${creds.username}:${creds.password}`,
  };

  let body: string | undefined;
  if (payload.method === "POST" && payload.params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(payload.params).toString();
  }

  const res = await fetch(url, { method: payload.method, headers, body });

  const contentType = res.headers.get("content-type") ?? "";
  let data: unknown;
  if (contentType.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  return { ok: res.ok, status: res.status, data };
}

// -- Main-world registration function (injected via chrome.scripting) -----
// This function runs in the page's main world. It receives TOOL_SCHEMAS as
// an argument. chrome.scripting.executeScript bypasses the page's CSP.

function registerToolsInMainWorld(schemas: ToolSchema[]) {
  const pending = new Map<string, { resolve: (v: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const CALL_TIMEOUT_MS = 600_000;
  let registered = false;
  const RETRY_MS = 2_000;
  const MAX_RETRIES = 15;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.type !== "webmcp:tool-result") return;
    const entry = pending.get(d.callId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(d.callId);
    if (d.error) entry.reject(new Error(d.error));
    else entry.resolve(d.result || "{}");
  });

  function tryRegister(): boolean {
    if (registered) return true;
    if (!navigator.modelContext) return false;
    for (const schema of schemas) {
      navigator.modelContext.registerTool({
        name: schema.name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        ...(schema.annotations ? { annotations: schema.annotations } : {}),
        execute(input: Record<string, unknown>, _client: { requestUserInteraction: (cb: () => void) => void }) {
          const callId = crypto.randomUUID();
          return new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(callId);
              reject(new Error(`Tool ${schema.name} timed out.`));
            }, CALL_TIMEOUT_MS);
            pending.set(callId, { resolve, reject, timer });
            window.postMessage({ type: "webmcp:tool-call", callId, tool: schema.name, params: input }, "*");
          });
        },
      });
    }
    registered = true;
    console.log(`[webmcp-main] Registered ${schemas.length} tools in main world.`);

    // Verify via testing API if available
    const testing = (navigator as { modelContextTesting?: { listTools: () => unknown[] } }).modelContextTesting;
    if (testing) {
      try {
        const tools = testing.listTools();
        console.log(`[webmcp-main] modelContextTesting.listTools() reports ${Array.isArray(tools) ? tools.length : "?"} tools.`);

        // Browser-returned object key order is implementation detail.
        // Expose name-first helpers for predictable UX in console output.
        if (Array.isArray(tools)) {
          const normalized = tools.map((t) => {
            const tool = (t ?? {}) as { name?: unknown; description?: unknown; inputSchema?: unknown };
            return {
              name: String(tool.name ?? ""),
              description: String(tool.description ?? ""),
              inputSchema: tool.inputSchema,
            };
          });

          (window as unknown as { __webmcpListTools?: () => unknown[] }).__webmcpListTools = () => normalized;
          (window as unknown as { __webmcpPrintTools?: () => void }).__webmcpPrintTools = () => {
            console.table(normalized.map((t) => ({ name: t.name, description: t.description })));
          };

          console.log(
            "[webmcp-main] Helpers installed: __webmcpListTools() and __webmcpPrintTools().",
          );
        }
      } catch (e) {
        console.warn("[webmcp-main] modelContextTesting.listTools() failed:", e);
      }
    } else {
      console.log("[webmcp-main] modelContextTesting not available (enable #enable-webmcp-testing flag to verify).");
    }
    return true;
  }

  console.log(`[webmcp-main] Injected via chrome.scripting. modelContext: ${!!navigator.modelContext}`);

  if (!tryRegister()) {
    console.warn("[webmcp-main] navigator.modelContext not available yet -- retrying...");
    let retries = 0;
    const interval = setInterval(() => {
      retries++;
      if (tryRegister() || retries >= MAX_RETRIES) {
        clearInterval(interval);
        if (!registered) {
          console.warn(
            `[webmcp-main] Gave up after ${MAX_RETRIES} retries. ` +
            `Ensure chrome://flags/#enable-webmcp-testing is Enabled and restart Chrome.`,
          );
        }
      }
    }, RETRY_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !registered) tryRegister();
    });
  }
}
