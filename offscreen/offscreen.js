const SANDBOX_FRAME_ID = "sandbox-frame";
const DEFAULT_JOB_TIMEOUT_MS = 120_000;

const pendingSandboxRequests = new Map();
let sandboxFramePromise = null;
let sandboxReady = false;
let resolveSandboxReady = null;
let jobKeepAlivePort = null;
let jobKeepAliveTimer = null;
const sandboxReadyPromise = new Promise((resolve) => {
  resolveSandboxReady = resolve;
});

function stopJobKeepAlive() {
  if (jobKeepAliveTimer) {
    clearInterval(jobKeepAliveTimer);
    jobKeepAliveTimer = null;
  }
  try { jobKeepAlivePort?.disconnect(); } catch { /* already disconnected */ }
  jobKeepAlivePort = null;
}

function startJobKeepAlive(jobId) {
  stopJobKeepAlive();
  try {
    jobKeepAlivePort = chrome.runtime.connect({ name: "job_keepalive" });
    jobKeepAlivePort.onDisconnect.addListener(() => {
      if (jobKeepAliveTimer) clearInterval(jobKeepAliveTimer);
      jobKeepAliveTimer = null;
      jobKeepAlivePort = null;
    });
    jobKeepAlivePort.postMessage({ type: "offscreen_job_keepalive", jobId });
    jobKeepAliveTimer = setInterval(() => {
      jobKeepAlivePort?.postMessage({ type: "offscreen_job_keepalive", jobId });
    }, 15_000);
  } catch {
    stopJobKeepAlive();
  }
}

function markSandboxReady() {
  sandboxReady = true;
  resolveSandboxReady?.();
}

async function waitForSandboxReady() {
  if (sandboxReady) return;
  await Promise.race([
    sandboxReadyPromise,
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

async function getSandboxUrl() {
  const manifestUrl = new URL("../manifest.json", location.href);
  const manifest = await fetch(manifestUrl).then((response) => response.json());
  const pages = Array.isArray(manifest.sandbox?.pages) ? manifest.sandbox.pages : [];
  const page = pages.includes("sandbox/sandbox.html") ? "sandbox/sandbox.html" : pages[0];
  const sandboxCsp = String(manifest.content_security_policy?.sandbox ?? "");
  if (page !== "sandbox/sandbox.html" || !sandboxCsp.includes("'unsafe-eval'")) {
    throw new Error(
      "Invalid sandbox manifest. Rebuild and reload the extension so manifest.sandbox.pages is sandbox/sandbox.html and sandbox CSP includes unsafe-eval.",
    );
  }
  return new URL(`../${page}`, location.href).href;
}

async function createSandboxFrame() {
  const existing = document.getElementById(SANDBOX_FRAME_ID);
  if (existing instanceof HTMLIFrameElement) {
    markSandboxReady();
    return existing;
  }

  const frame = document.createElement("iframe");
  frame.id = SANDBOX_FRAME_ID;
  frame.title = "Code mode sandbox";
  frame.hidden = true;
  frame.src = await getSandboxUrl();

  const loaded = new Promise((resolve, reject) => {
    frame.addEventListener("load", () => resolve(frame), { once: true });
    frame.addEventListener("error", () => reject(new Error("Sandbox frame failed to load.")), { once: true });
  });

  document.body.appendChild(frame);
  return loaded;
}

function ensureSandboxFrame() {
  if (!sandboxFramePromise) {
    sandboxFramePromise = createSandboxFrame();
  }
  return sandboxFramePromise;
}

async function postToSandbox(message) {
  const frame = await ensureSandboxFrame();
  await waitForSandboxReady();
  frame.contentWindow?.postMessage(message, "*");
}

function rejectPendingJobRequests(jobId, error) {
  for (const [requestId, entry] of pendingSandboxRequests.entries()) {
    if (entry.jobId !== jobId) continue;
    clearTimeout(entry.timer);
    pendingSandboxRequests.delete(requestId);
    entry.reject(error);
  }
}

async function requestSandbox(message, timeoutMs = DEFAULT_JOB_TIMEOUT_MS) {
  const requestId = crypto.randomUUID();
  startJobKeepAlive(message.jobId);
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingSandboxRequests.delete(requestId);
      stopJobKeepAlive();
      reject(new Error(`Sandbox execution timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    pendingSandboxRequests.set(requestId, {
      resolve: (value) => {
        stopJobKeepAlive();
        resolve(value);
      },
      reject: (reason) => {
        stopJobKeepAlive();
        reject(reason);
      },
      timer,
      jobId: message.jobId,
    });
  });
  await postToSandbox({ ...message, requestId });
  return response;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;
  const { type } = message;

  if (type === "offscreen_ping") {
    sendResponse({ ok: true, target: "offscreen" });
    return false;
  }

  if (type === "sandbox_ping") {
    postToSandbox({ type: "sandbox_ping" })
      .then(() => sendResponse({ ok: true, target: "offscreen", forwarded: true }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (type === "offscreen_job_execute") {
    requestSandbox({
      type: "sandbox_execute",
      jobId: message.jobId,
      jsCode: message.jsCode,
      context: message.context,
    }, Number(message.timeoutMs) || DEFAULT_JOB_TIMEOUT_MS)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (type === "offscreen_job_abort") {
    rejectPendingJobRequests(message.jobId, new Error("Sandbox execution was aborted."));
    stopJobKeepAlive();
    postToSandbox({ type: "sandbox_abort", jobId: message.jobId })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  return false;
});

window.addEventListener("message", (event) => {
  const sandboxFrame = document.getElementById(SANDBOX_FRAME_ID);
  if (!(sandboxFrame instanceof HTMLIFrameElement) || event.source !== sandboxFrame.contentWindow) return;
  const data = event.data ?? {};

  if (data?.type === "sandbox_ready") {
    markSandboxReady();
    chrome.runtime.sendMessage({ type: "sandbox_ready" }).catch(() => {
      // The service worker may be asleep; readiness is best-effort for now.
    });
    return;
  }

  if (data.type === "sandbox_result" || data.type === "sandbox_error") {
    const entry = pendingSandboxRequests.get(data.requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
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

ensureSandboxFrame().catch(console.error);
