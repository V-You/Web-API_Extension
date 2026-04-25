/**
 * Isolated-world bridge -- receives tool calls from the main world and
 * executes them with full chrome API access (credentials, storage, fetch).
 *
 * Runs in the default isolated world. Credentials never cross the
 * postMessage boundary. The actual tool execution is delegated to the
 * service worker so credential-backed tools can use extension storage.
 *
 * On load, asks the service worker to inject the main-world registration
 * script via chrome.scripting.executeScript (bypasses page CSP).
 */

// -- Message listener (main world -> isolated world) ----------------------

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.type !== "webmcp:tool-call") return;

  const { callId, tool, params } = data as {
    callId: string;
    tool: string;
    params: Record<string, unknown>;
  };

  try {
    const response = await chrome.runtime.sendMessage({
      type: "webmcp:execute-tool",
      payload: { tool, params },
    }) as { ok?: boolean; result?: string; error?: string } | undefined;

    if (!response?.ok) {
      window.postMessage({
        type: "webmcp:tool-result",
        callId,
        error: response?.error ?? `Tool ${tool} failed.`,
      }, "*");
      return;
    }

    window.postMessage({ type: "webmcp:tool-result", callId, result: response.result ?? "{}" }, "*");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    window.postMessage({ type: "webmcp:tool-result", callId, error: msg }, "*");
  }
});

// -- Build timestamp (DefinePlugin may not apply to content scripts) ------

let buildTs = "unknown";
try { buildTs = __BUILD_TIMESTAMP__; } catch { /* not replaced by DefinePlugin */ }

console.log(
  `[webmcp-bridge] Isolated-world bridge ready (built ${buildTs}). URL: ${location.href}`,
);

// -- Request main-world injection from service worker ---------------------
// Uses chrome.scripting.executeScript with world: "MAIN" to bypass page CSP.

chrome.runtime.sendMessage({ type: "webmcp:inject-main" }, (resp) => {
  if (chrome.runtime.lastError) {
    console.error("[webmcp-bridge] Failed to request main-world injection:", chrome.runtime.lastError.message);
  } else if (resp && !resp.ok) {
    console.error("[webmcp-bridge] Main-world injection failed:", resp.error);
  } else {
    console.log("[webmcp-bridge] Main-world registration injected via service worker.");
  }
});
