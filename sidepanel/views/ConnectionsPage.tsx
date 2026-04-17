import { useEffect, useMemo, useRef, useState } from "react";
import type { Environment, ApiCredentials } from "../../src/lib/types";
import { ENV_DEFAULTS } from "../../src/lib/types";
import type { EntityType } from "../../src/lib/entity-types";
import { buildConnectionProbeUrl, classifyConnectionProbeResponse } from "../../src/lib/connection-probe";
import {
  saveCredentials,
  getCredentials,
  forgetCredentials,
  setActiveEnv,
  getActiveEnv,
  getThrottleRate,
  setThrottleRate,
} from "../../src/lib/storage";

interface Props {
  onChanged: () => void;
}

const TEST_COOLDOWN_MS = 2000;

export function ConnectionsPage({ onChanged }: Props) {
  const [selectedEnv, setSelectedEnv] = useState<Environment>("uat");
  const [uatSaved, setUatSaved] = useState(false);
  const [prodSaved, setProdSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const [uat, prod] = await Promise.all([
        getCredentials("uat"),
        getCredentials("prod"),
      ]);
      setUatSaved(!!uat);
      setProdSaved(!!prod);

      const active = await getActiveEnv();
      if (active) setSelectedEnv(active);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(["uat", "prod"] as const).map((env) => (
          <button
            key={env}
            onClick={async () => {
              setSelectedEnv(env);
              await setActiveEnv(env);
              onChanged();
            }}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md border transition-colors ${
              selectedEnv === env
                ? env === "prod"
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-blue-300 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {env.toUpperCase()}{" "}
            {(env === "uat" ? uatSaved : prodSaved) ? "(saved)" : ""}
          </button>
        ))}
      </div>

      {selectedEnv === "prod" && (
        <p className="text-[10px] text-red-500">
          Production environment -- all write operations require confirmation.
        </p>
      )}

      <CredentialForm
        env={selectedEnv}
        hasSaved={selectedEnv === "uat" ? uatSaved : prodSaved}
        onSaved={() => {
          if (selectedEnv === "uat") setUatSaved(true);
          else setProdSaved(true);
          onChanged();
        }}
        onDeleted={() => {
          if (selectedEnv === "uat") setUatSaved(false);
          else setProdSaved(false);
          onChanged();
        }}
      />

      <ThrottleRateSetting />
    </div>
  );
}

function CredentialForm({
  env,
  hasSaved,
  onSaved,
  onDeleted,
}: {
  env: Environment;
  hasSaved: boolean;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const defaults = ENV_DEFAULTS[env];
  const testBusyRef = useRef(false);
  const [baseUrl, setBaseUrl] = useState(defaults.baseUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scopeEntityType, setScopeEntityType] = useState<EntityType>("psp");
  const [scopeEntityId, setScopeEntityId] = useState("");
  const [pin, setPin] = useState("");
  const [savedCreds, setSavedCreds] = useState<ApiCredentials | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const [testCooldownMs, setTestCooldownMs] = useState(0);

  useEffect(() => {
    if (testCooldownMs <= 0) return;
    const interval = setInterval(() => {
      setTestCooldownMs((current) => Math.max(0, current - 100));
    }, 100);

    return () => clearInterval(interval);
  }, [testCooldownMs]);

  // Reset or hydrate the form when env changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getCredentials(env);
      if (cancelled) return;
      setSavedCreds(saved);
      setBaseUrl(saved?.baseUrl ?? ENV_DEFAULTS[env].baseUrl);
      setUsername(saved?.username ?? "");
      setPassword("");
      setScopeEntityType(saved?.scopeEntityType ?? "psp");
      setScopeEntityId(saved?.scopeEntityId ?? saved?.pspId ?? "");
      setPin("");
      setError(null);
      setTestResult(null);
    })();

    return () => {
      cancelled = true;
    };
  }, [env]);

  async function handleSave() {
    if (!username || !password || !scopeEntityId || !pin) {
      setError("All fields are required.");
      return;
    }
    if (pin.length < 6) {
      setError("PIN must be at least 6 characters.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const creds: ApiCredentials = {
        baseUrl,
        username,
        password,
        scopeEntityType,
        scopeEntityId: scopeEntityId.trim(),
        pspId: scopeEntityType === "psp" ? scopeEntityId.trim() : undefined,
      };
      await saveCredentials(env, creds, pin);
      setSavedCreds(creds);
      await setActiveEnv(env);
      setPassword("");
      setPin("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save credentials.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await forgetCredentials(env);
      setSavedCreds(null);
      setBaseUrl(ENV_DEFAULTS[env].baseUrl);
      setUsername("");
      setPassword("");
      setScopeEntityType("psp");
      setScopeEntityId("");
      setPin("");
      setError(null);
      setTestResult(null);
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (testBusyRef.current || testCooldownMs > 0) return;
    testBusyRef.current = true;
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const probeCreds: ApiCredentials = {
        baseUrl,
        username: username || savedCreds?.username || "",
        password: password || savedCreds?.password || "",
        scopeEntityType: scopeEntityType,
        scopeEntityId: scopeEntityId || savedCreds?.scopeEntityId || savedCreds?.pspId,
      };

      if (!probeCreds.username || !probeCreds.password || !probeCreds.scopeEntityId) {
        setError("Username, password, and entity ID are required to test.");
        return;
      }

      const url = buildConnectionProbeUrl(probeCreds);
      if (!url) {
        setError("Entity ID is required to test.");
        return;
      }

      const res = await fetch(url, {
        method: "GET",
        headers: { credentials: `${probeCreds.username}:${probeCreds.password}` },
      });

      const result = await classifyConnectionProbeResponse(res);
      if (result.ok) {
        setTestResult("ok");
      } else {
        setTestResult("fail");
        setError(result.message);
      }
    } catch (e) {
      setTestResult("fail");
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setTestCooldownMs(TEST_COOLDOWN_MS);
      setBusy(false);
      testBusyRef.current = false;
    }
  }

  const effectiveTestConfig = useMemo(() => {
    const effectivePasswordSource = password
      ? "Typed password"
      : savedCreds?.password
        ? "Saved password"
        : "Missing password";

    const effectiveEntityType = scopeEntityType;
    const effectiveEntityId = scopeEntityId || savedCreds?.scopeEntityId || savedCreds?.pspId || "Not set";

    return {
      baseUrl: baseUrl || savedCreds?.baseUrl || ENV_DEFAULTS[env].baseUrl,
      username: username || savedCreds?.username || "Not set",
      entityType: effectiveEntityType,
      entityId: effectiveEntityId,
      passwordSource: effectivePasswordSource,
      probeUrl: buildConnectionProbeUrl({
        baseUrl: baseUrl || savedCreds?.baseUrl || ENV_DEFAULTS[env].baseUrl,
        scopeEntityType: effectiveEntityType,
        scopeEntityId: scopeEntityId || savedCreds?.scopeEntityId || savedCreds?.pspId,
      }) ?? "Unavailable until entity ID is set",
    };
  }, [baseUrl, env, password, scopeEntityId, scopeEntityType, savedCreds, username]);

  const testCooldownPct = testCooldownMs > 0
    ? Math.max(0, Math.min(100, (testCooldownMs / TEST_COOLDOWN_MS) * 100))
    : 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <ConfigSummaryCard
          title="Saved configuration"
          emptyMessage="No saved credentials for this environment yet."
          rows={savedCreds ? [
            { label: "Username", value: savedCreds.username },
            { label: "Base URL", value: savedCreds.baseUrl },
            { label: "Scope", value: `${(savedCreds.scopeEntityType ?? "psp").toUpperCase()} ${savedCreds.scopeEntityId ?? savedCreds.pspId ?? "Not set"}` },
          ] : []}
        />
        <ConfigSummaryCard
          title="Connection test target"
          rows={[
            { label: "Username", value: effectiveTestConfig.username },
            { label: "Base URL", value: effectiveTestConfig.baseUrl },
            { label: "Scope", value: `${effectiveTestConfig.entityType.toUpperCase()} ${effectiveTestConfig.entityId}` },
            { label: "Password", value: effectiveTestConfig.passwordSource },
            { label: "Probe", value: effectiveTestConfig.probeUrl },
          ]}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Base URL
        </label>
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Username
        </label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Password
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Attachment level
        </label>
        <div className="flex gap-2">
          <select
            value={scopeEntityType}
            onChange={(e) => setScopeEntityType(e.target.value as EntityType)}
            className="border border-slate-200 rounded-md px-2 py-1.5 text-xs"
          >
            <option value="psp">PSP</option>
            <option value="division">Division</option>
            <option value="merchant">Merchant</option>
            <option value="channel">Channel</option>
          </select>
          <input
            type="text"
            value={scopeEntityId}
            onChange={(e) => setScopeEntityId(e.target.value)}
            autoComplete="off"
            placeholder={`${scopeEntityType.charAt(0).toUpperCase() + scopeEntityType.slice(1)} entity ID`}
            className="flex-1 border border-slate-200 rounded-md px-2 py-1.5 text-xs"
          />
        </div>
        <p className="text-[10px] text-slate-400 mt-1">
          The entity this Web API user is attached to. Connection test probes this entity.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Encryption PIN
        </label>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Minimum 6 characters"
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {testResult === "ok" && (
        <p className="text-xs text-green-600">Connection successful.</p>
      )}

      <div className="space-y-1.5">
        <div className="flex gap-2">
          <button
            onClick={handleTest}
            disabled={busy || testCooldownMs > 0}
            className="bg-slate-100 text-slate-700 text-xs font-medium py-1.5 px-3 rounded-md hover:bg-slate-200 disabled:opacity-50 transition-colors"
          >
            {busy ? "Testing..." : testCooldownMs > 0 ? `Wait ${Math.ceil(testCooldownMs / 1000)}s` : "Test"}
          </button>
        <button
          onClick={handleSave}
          disabled={busy}
          className="flex-1 bg-blue-600 text-white text-xs font-medium py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {busy ? "Saving..." : "Save credentials"}
        </button>
        {hasSaved && (
          <button
            onClick={handleDelete}
            disabled={busy}
            className="text-xs text-red-600 hover:text-red-700 px-3"
          >
            Remove
          </button>
        )}
        </div>
        {testCooldownMs > 0 && (
          <div className="h-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-slate-400 transition-[width] duration-100"
              style={{ width: `${testCooldownPct}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigSummaryCard({
  title,
  rows,
  emptyMessage,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
  emptyMessage?: string;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      <h3 className="font-semibold text-slate-700">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-slate-500">{emptyMessage ?? "No values available."}</p>
      ) : (
        <dl className="mt-1 space-y-1">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{row.label}</dt>
              <dd className="break-all text-slate-700">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function ThrottleRateSetting() {
  const [rate, setRate] = useState(9);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getThrottleRate().then(setRate);
  }, []);

  async function handleSave() {
    await setThrottleRate(rate);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="border-t border-slate-200 pt-4 mt-4 space-y-2">
      <h3 className="text-xs font-semibold text-slate-600">Throttle rate</h3>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={1}
          max={50}
          value={rate}
          onChange={(e) => setRate(Number(e.target.value))}
          className="w-20 border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
        <span className="text-xs text-slate-500">req/s</span>
        <button
          onClick={handleSave}
          className="text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      <p className="text-[10px] text-slate-400">
        Maximum API requests per second for jobs and batch operations (default: 9).
        Higher values may trigger rate limiting.
      </p>
    </div>
  );
}
