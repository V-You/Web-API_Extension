import { useState, useEffect } from "react";
import type { Environment, ApiCredentials } from "@/lib/types";
import { ENV_DEFAULTS } from "@/lib/types";
import {
  saveCredentials,
  getCredentials,
  forgetCredentials,
  setActiveEnv,
  getActiveEnv,
} from "@/lib/storage";

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

  // Reset form when env changes
  useEffect(() => {
    setBaseUrl(ENV_DEFAULTS[env].baseUrl);
    setUsername("");
    setPassword("");
    setPin("");
    setError(null);
  }, [env]);

  async function handleSave() {
    if (!username || !password || !pin) {
      setError("All fields are required.");
      return;
    }
    if (pin.length < 4) {
      setError("PIN must be at least 4 characters.");
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
          placeholder="Minimum 4 characters"
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
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
