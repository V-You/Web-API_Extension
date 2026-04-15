import type { EntityType } from "./entity-types";
import { ENTITY_PLURAL } from "./entity-types";
import type { ApiCredentials } from "./types";

export interface ConnectionProbeResult {
  ok: boolean;
  message: string;
}

export interface ConnectionProbeParams {
  baseUrl: string;
  scopeEntityId?: string;
  scopeEntityType?: EntityType;
  /** @deprecated Fallback for legacy saved credentials. */
  pspId?: string;
}

/**
 * Build the probe URL using GET /{entityPlural}/{entityId}/ownedContacts.
 * Works at all entity levels (PSP, division, merchant, channel).
 */
export function buildConnectionProbeUrl(creds: ConnectionProbeParams): string | null {
  const entityType = creds.scopeEntityType ?? "psp";
  const entityId = (creds.scopeEntityId ?? creds.pspId)?.trim();
  if (!entityId) return null;
  const baseUrl = creds.baseUrl.replace(/\/$/, "");
  const plural = ENTITY_PLURAL[entityType];
  return `${baseUrl}/${plural}/${encodeURIComponent(entityId)}/ownedContacts`;
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
    return { ok: false, message: "Entity not found. Check entity type and ID." };
  }

  if (res.ok) {
    return { ok: true, message: "Connection successful." };
  }

  return { ok: false, message: `Unexpected response: ${res.status}` };
}