const SANDBOX_FRAME_ID = "sandbox-frame";

const pendingSandboxRequests = new Map();

function getSandboxUrl() {
  const page = chrome.runtime.getManifest().sandbox?.pages?.[0];
  if (!page) throw new Error("No sandbox page is declared in manifest.json.");
  return chrome.runtime.getURL(page);
}

function ensureSandboxFrame() {
  const existing = document.getElementById(SANDBOX_FRAME_ID);
  if (existing instanceof HTMLIFrameElement) return existing;

  const frame = document.createElement("iframe");
  frame.id = SANDBOX_FRAME_ID;
  frame.title = "Code mode sandbox";
  frame.src = getSandboxUrl();
  frame.hidden = true;
  document.body.appendChild(frame);
  return frame;
}

function getSandboxFrame() {
  return ensureSandboxFrame();
}

function postToSandbox(message) {
  const frame = getSandboxFrame();
  frame.contentWindow?.postMessage(message, "*");
}

function requestSandbox(message) {
  const requestId = crypto.randomUUID();
  postToSandbox({ ...message, requestId });

  return new Promise((resolve, reject) => {
    pendingSandboxRequests.set(requestId, { resolve, reject });
  });
}

ensureSandboxFrame();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const { type } = message;

  if (type === "offscreen_ping") {
    sendResponse({ ok: true, target: "offscreen" });
    return false;
  }

  if (type === "sandbox_ping") {
    postToSandbox({ type: "sandbox_ping" });
    sendResponse({ ok: true, target: "offscreen", forwarded: true });
    return false;
  }

  if (type === "offscreen_job_execute") {
    requestSandbox({
      type: "sandbox_execute",
      jobId: message.jobId,
      jsCode: message.jsCode,
      context: message.context,
    })
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (type === "offscreen_job_abort") {
    postToSandbox({ type: "sandbox_abort", jobId: message.jobId });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

window.addEventListener("message", (event) => {
  if (event.source !== getSandboxFrame().contentWindow) return;
  const data = event.data ?? {};

  if (data?.type === "sandbox_ready") {
    chrome.runtime.sendMessage({ type: "sandbox_ready" }).catch(() => {
      // The service worker may be asleep; readiness is best-effort for now.
    });
    return;
  }

  if (data.type === "sandbox_result" || data.type === "sandbox_error") {
    const entry = pendingSandboxRequests.get(data.requestId);
    if (!entry) return;
    pendingSandboxRequests.delete(data.requestId);
    if (data.type === "sandbox_error") entry.reject(new Error(String(data.error ?? "Sandbox execution failed.")));
    else entry.resolve(data.result);
    return;
  }

  if (data.type === "sandbox_sdk_call") {
    chrome.runtime.sendMessage({
      type: "sandbox_sdk_call",
      jobId: data.jobId,
      requestId: data.requestId,
      path: data.path,
      args: data.args,
    })
      .then((response) => {
        if (!response?.ok) throw new Error(response?.error ?? "SDK call failed.");
        postToSandbox({ type: "sandbox_sdk_result", requestId: data.requestId, result: response.result });
      })
      .catch((err) => postToSandbox({ type: "sandbox_sdk_error", requestId: data.requestId, error: err instanceof Error ? err.message : String(err) }));
    return;
  }

  if (data.type === "sandbox_progress") {
    chrome.runtime.sendMessage({
      type: "sandbox_progress",
      jobId: data.jobId,
      completedCalls: data.completedCalls,
      totalCalls: data.totalCalls,
      checkpoint: data.checkpoint,
    }).catch(() => {
      // Progress is best effort; the final job result still persists state.
    });
  }
});