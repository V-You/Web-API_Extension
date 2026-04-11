import { useState, useEffect } from "react";
import type { Environment, ApiCredentials } from "../../src/lib/types";
import { ENV_DEFAULTS } from "../../src/lib/types";
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
      <h2 className="text-base font-semibold">Connections</h2>

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
  const [baseUrl, setBaseUrl] = useState(defaults.baseUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);

  // Reset form when env changes
  useEffect(() => {
    setBaseUrl(ENV_DEFAULTS[env].baseUrl);
    setUsername("");
    setPassword("");
    setPin("");
    setError(null);
    setTestResult(null);
  }, [env]);

  async function handleSave() {
    if (!username || !password || !pin) {
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
      const creds: ApiCredentials = { baseUrl, username, password };
      await saveCredentials(env, creds, pin);
      await setActiveEnv(env);
      setUsername("");
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
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    if (!username || !password) {
      setError("Username and password are required to test.");
      return;
    }
    setBusy(true);
    setError(null);
    setTestResult(null);
    try {
      const url = `${baseUrl}/divisions`;
      const res = await fetch(url, {
        method: "GET",
        headers: { credentials: `${username}:${password}` },
      });
      if (res.status === 401 || res.status === 403) {
        setTestResult("fail");
        setError(`Authentication failed (${res.status}).`);
      } else if (res.ok) {
        setTestResult("ok");
      } else {
        setTestResult("fail");
        setError(`Unexpected response: ${res.status}`);
      }
    } catch (e) {
      setTestResult("fail");
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
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

      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={busy}
          className="bg-slate-100 text-slate-700 text-xs font-medium py-1.5 px-3 rounded-md hover:bg-slate-200 disabled:opacity-50 transition-colors"
        >
          {busy ? "Testing..." : "Test"}
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
