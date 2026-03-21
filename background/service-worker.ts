/**
 * Background service worker.
 *
 * Responsibilities:
 *   1. Open the side panel when the extension action icon is clicked.
 *   2. Relay API requests from the side panel (message passing).
 *   3. Detect tab closure to signal job pause.
 *   4. On startup, mark any "running" jobs as "paused" (browser restart recovery).
 */

// -- Side panel activation ------------------------------------------------

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

// -- Browser restart recovery ---------------------------------------------
// If the browser restarted while a job was running, mark it as paused
// so the side panel can offer to resume.

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

// -- Tab removal detection ------------------------------------------------
// Per PRD 8.2: if the BIP tab is closed, the job should pause.
// The side panel listens for this message to trigger pauseJob().

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.runtime.sendMessage({ type: "tab_closed", tabId }).catch(() => {
    // Side panel may not be open -- ignore
  });
});

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

    // Job control messages are forwarded to the side panel context.
    // The service worker itself doesn't manage job state -- the side panel does.
    // These are here for external triggers (e.g., popup, keyboard shortcuts).
    if (message.type === "job_pause" || message.type === "job_cancel") {
      // Relay to all extension views (side panel listens)
      chrome.runtime.sendMessage(message).catch(() => {});
      sendResponse({ ok: true });
      return false;
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
