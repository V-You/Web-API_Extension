import type { ApiCredentials } from "./types";

export interface ConnectionProbeResult {
  ok: boolean;
  message: string;
}

export function buildConnectionProbeUrl(creds: Pick<ApiCredentials, "baseUrl" | "pspId">): string | null {
  const pspId = creds.pspId?.trim();
  if (!pspId) return null;
  const baseUrl = creds.baseUrl.replace(/\/$/, "");
  return `${baseUrl}/psps/${encodeURIComponent(pspId)}/divisions`;
}

export async function classifyConnectionProbeResponse(res: Response): Promise<ConnectionProbeResult> {
  let bodyText: string;

  try {
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      bodyText = JSON.stringify(await res.json());
    } else {
      bodyText = await res.text();
    }
  } catch {
    bodyText = "";
  }

  const normalized = bodyText.toLowerCase();
  if (normalized.includes("invalid credentials")) {
    return { ok: false, message: "Invalid credentials." };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, message: `Authentication failed (${res.status}).` };
  }

  if (res.status === 404) {
    return { ok: false, message: "Probe endpoint not found. Check base URL and PSP ID." };
  }

  if (res.ok) {
    return { ok: true, message: "Connection successful." };
  }

  return { ok: false, message: `Unexpected response: ${res.status}` };
}