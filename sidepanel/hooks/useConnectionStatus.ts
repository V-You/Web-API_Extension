import { useCallback, useEffect, useRef, useState } from "react";
import { useCredentialStore } from "../../src/hooks/useCredentialStore";
import { getCredentials } from "../../src/lib/storage";
import {
  buildConnectionProbeUrl,
  classifyConnectionProbeResponse,
  type ConnectionProbeResult,
} from "../../src/lib/connection-probe";
import type { ApiCredentials, Environment } from "../../src/lib/types";

export type ConnectionStatus = "idle" | "checking" | "ok" | "fail";

export interface ConnectionState {
  status: ConnectionStatus;
  message: string;
  scopeLabel: string | null;
  env: Environment | null;
}

const IDLE_STATE: ConnectionState = { status: "idle", message: "Not connected", scopeLabel: null, env: null };

/** Run a single connection probe without any hook lifecycle. Accepts signal for cancellation. */
export async function runConnectionProbe(
  creds: ApiCredentials,
  signal?: AbortSignal,
): Promise<ConnectionProbeResult> {
  const url = buildConnectionProbeUrl(creds);
  if (!url) return { ok: false, message: "Entity ID is required to test." };
  if (!creds.username || !creds.password) {
    return { ok: false, message: "Username and password are required to test." };
  }
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { credentials: `${creds.username}:${creds.password}` },
      signal,
    });
    return await classifyConnectionProbeResponse(res);
  } catch (err) {
    if ((err as { name?: string })?.name === "AbortError") throw err;
    return { ok: false, message: err instanceof Error ? err.message : "Connection failed." };
  }
}

function scopeLabelFor(creds: ApiCredentials): string {
  const id = creds.scopeEntityId ?? creds.pspId;
  return id ? `${creds.scopeEntityType ?? "psp"} ${id}` : "saved scope";
}

/**
 * Auto-probe the current active environment's saved credentials.
 *
 * Used by HomePage for full message display and by the shell header for the
 * connection indicator dot. A single probe runs per active-env change; callers
 * can force a re-run via retry().
 */
export function useConnectionStatus(): ConnectionState & { retry: () => void } {
  const { isUnlocked, activeEnv } = useCredentialStore();
  const [state, setState] = useState<ConnectionState>(IDLE_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const probe = useCallback(async () => {
    if (!isUnlocked || !activeEnv) {
      setState(IDLE_STATE);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "checking", message: "Checking connection...", scopeLabel: null, env: activeEnv });

    const creds = await getCredentials(activeEnv);
    if (controller.signal.aborted) return;

    if (!creds || !buildConnectionProbeUrl(creds)) {
      setState({
        status: "fail",
        message: "Connection not configured - add credentials and entity scope in Connections.",
        scopeLabel: null,
        env: activeEnv,
      });
      return;
    }

    try {
      const result = await runConnectionProbe(creds, controller.signal);
      if (controller.signal.aborted) return;
      const scope = scopeLabelFor(creds);
      setState({
        status: result.ok ? "ok" : "fail",
        message: result.ok
          ? `Connected to Web API (${activeEnv.toUpperCase()}, ${scope})`
          : `${activeEnv.toUpperCase()} Web API check failed for ${scope}: ${result.message}`,
        scopeLabel: scope,
        env: activeEnv,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      setState({
        status: "fail",
        message: err instanceof Error ? err.message : "Connection failed.",
        scopeLabel: null,
        env: activeEnv,
      });
    }
  }, [isUnlocked, activeEnv]);

  useEffect(() => {
    void probe();
    return () => abortRef.current?.abort();
  }, [probe]);

  return { ...state, retry: () => void probe() };
}
