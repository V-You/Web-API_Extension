/**
 * Background service worker.
 *
 * Responsibilities:
 *   1. Open the side panel when the extension action icon is clicked.
 *   2. Relay API requests from the side panel (message passing).
 *   3. Execute long-running jobs (e.g., hierarchy-wide audits) with
 *      pause/resume/cancel support.
 */

// -- Side panel activation ------------------------------------------------

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(console.error);

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

export interface ApiMessageResponse {
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}

chrome.runtime.onMessage.addListener(
  (
    message: ApiMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: ApiMessageResponse) => void
  ) => {
    if (message.type === "api_request") {
      handleApiRequest(message.payload)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({
            ok: false,
            status: 0,
            data: null,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      // Return true to keep the message channel open for async response
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
