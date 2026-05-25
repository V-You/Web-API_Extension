import { useEffect, useMemo, useRef, useState } from "react";
import type { Environment, ApiCredentials } from "../../src/lib/types";
import { ENV_DEFAULTS } from "../../src/lib/types";
import type { EntityType } from "../../src/lib/entity-types";
import { buildConnectionProbeUrl } from "../../src/lib/connection-probe";
import { runConnectionProbe } from "../hooks/useConnectionStatus";
import {
  saveCredentials,
  getCredentials,
  forgetCredentials,
  setActiveEnv,
  getActiveEnv,
  getThrottleRate,
  setThrottleRate,
  getTransactionTokens,
  saveTransactionToken,
  deleteTransactionToken,
  type TransactionTokenRecord,
} from "../../src/lib/storage";
import { apiRequest } from "../../src/lib/api-client";
import { maskSecret, redactSecrets } from "../../src/lib/redact";
import { sendExampleTransaction } from "../../src/lib/transaction-client";
import {
  DEFAULT_GATEWAY_HOST,
  DEFAULT_POLICY_PATH,
  DEFAULT_TELEMETRY_PATH,
  forgetGatewayToken,
  getGatewaySessionToken,
  getGatewaySettings,
  hasStoredGatewayToken,
  isGatewayTokenInvalid,
  saveGatewaySettings,
  saveGatewayToken,
  type GatewaySettings,
} from "../../src/gateway/gateway-storage";

interface Props {
  onChanged: () => void;
}

const TEST_COOLDOWN_MS = 2000;
const DEFAULT_TRANSACTION_BODY = [
  "entityId=8ac7a4c79394bdc801939736f17e063d",
  "amount=92.00",
  "currency=EUR",
  "paymentBrand=VISA",
  "paymentType=PA",
  "card.number=4200000000000000",
  "card.holder=Jane Jones",
  "card.expiryMonth=05",
  "card.expiryYear=2034",
  "card.cvv=123",
].join("\n");

interface ApiTokenMetadata {
  id: string;
  alias: string;
  createdTime: string;
  lastDigits: string;
  lastUsedTime: string;
  state: string;
  apiBearerToken?: string;
}

interface ApiTokenResponse {
  apiToken?: ApiTokenMetadata;
  apiTokens?: ApiTokenMetadata[];
  error?: { message?: string };
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
        <p className="text-2xs text-red-500">
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

      <TransactionTokenVault env={selectedEnv} />

      <GatewaySettingsSection />

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

      const result = await runConnectionProbe(probeCreds);
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

  // Dirty if any field has been edited away from what is currently saved.
  const isDirty =
    baseUrl !== (savedCreds?.baseUrl ?? ENV_DEFAULTS[env].baseUrl) ||
    username !== (savedCreds?.username ?? "") ||
    password !== "" ||
    scopeEntityType !== (savedCreds?.scopeEntityType ?? "psp") ||
    scopeEntityId !== (savedCreds?.scopeEntityId ?? savedCreds?.pspId ?? "") ||
    pin !== "";

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
          Entity scope
        </label>
        <div className="flex gap-2">
          <select
            value={scopeEntityType}
            onChange={(e) => setScopeEntityType(e.target.value as EntityType)}
            aria-label="Select entity type"
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
        <p className="text-2xs text-slate-400 mt-1">
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

      {error && (
        <div className="flex items-start gap-2 text-xs text-red-600">
          <span className="flex-1">{error}</span>
          {testResult === "fail" && testCooldownMs === 0 && (
            <button
              onClick={handleTest}
              disabled={busy}
              className="font-medium underline underline-offset-2 hover:text-red-700 disabled:opacity-50"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {testResult === "ok" && (
        <p className="text-xs text-emerald-600">Connection successful.</p>
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
          className="relative flex-1 bg-blue-600 text-white text-xs font-medium py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {busy ? "Saving..." : "Save credentials"}
          {isDirty && !busy && (
            <span
              aria-label="Unsaved changes"
              title="Unsaved changes"
              className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-amber-300"
            />
          )}
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

function TransactionTokenVault({ env }: { env: Environment }) {
  const [tokens, setTokens] = useState<TransactionTokenRecord[]>([]);
  const [merchantId, setMerchantId] = useState("");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [pin, setPin] = useState("");
  const [apiTokens, setApiTokens] = useState<ApiTokenMetadata[]>([]);
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [transactionBody, setTransactionBody] = useState(DEFAULT_TRANSACTION_BODY);
  const [transactionResult, setTransactionResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTransactionTokens(env).then((rows) => {
      if (!cancelled) setTokens(rows);
    });
    setMerchantId("");
    setLabel("");
    setToken("");
    setPin("");
    setApiTokens([]);
    setSelectedTokenId("");
    setTransactionBody(DEFAULT_TRANSACTION_BODY);
    setTransactionResult(null);
    setError(null);
    setSaved(false);
    return () => {
      cancelled = true;
    };
  }, [env]);

  async function refresh() {
    const rows = await getTransactionTokens(env);
    setTokens(rows);
    if (selectedTokenId && !rows.some((row) => row.id === selectedTokenId)) {
      setSelectedTokenId("");
    }
  }

  async function handleSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await saveTransactionToken(env, { merchantId, label, token }, pin);
      await refresh();
      setMerchantId("");
      setLabel("");
      setToken("");
      setPin("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save transaction token.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteTransactionToken(env, id, pin);
      await refresh();
      setPin("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete transaction token.");
    } finally {
      setBusy(false);
    }
  }

  async function requireCreds(): Promise<ApiCredentials> {
    const creds = await getCredentials(env);
    if (!creds) throw new Error("Unlock Web API credentials before using API token controls.");
    return creds;
  }

  async function listApiTokens(targetMerchantId = merchantId.trim()) {
    if (!targetMerchantId) throw new Error("Merchant entity UUID is required.");
    const creds = await requireCreds();
    const res = await apiRequest<ApiTokenResponse>(creds, env, {
      path: `/merchants/${encodeURIComponent(targetMerchantId)}/apiTokens`,
    });
    if (!res.ok || res.data.error) throw new Error(res.data.error?.message ?? "Failed to list API tokens.");
    setApiTokens(res.data.apiTokens ?? []);
  }

  async function updateApiTokenAlias(creds: ApiCredentials, apiTokenId: string, alias: string) {
    return apiRequest<ApiTokenResponse>(creds, env, {
      method: "POST",
      path: `/apiTokens/${encodeURIComponent(apiTokenId)}`,
      params: { alias },
    }, {
      eventType: "api_token_update",
      entityId: apiTokenId,
      entityType: "apiToken",
    });
  }

  async function suspendApiToken(creds: ApiCredentials, apiTokenId: string) {
    return apiRequest<ApiTokenResponse>(creds, env, {
      method: "POST",
      path: `/apiTokens/${encodeURIComponent(apiTokenId)}/suspend`,
    }, {
      eventType: "api_token_suspend",
      entityId: apiTokenId,
      entityType: "apiToken",
    });
  }

  async function deleteApiToken(creds: ApiCredentials, apiTokenId: string) {
    return apiRequest<ApiTokenResponse>(creds, env, {
      method: "DELETE",
      path: `/apiTokens/${encodeURIComponent(apiTokenId)}`,
    }, {
      eventType: "api_token_delete",
      entityId: apiTokenId,
      entityType: "apiToken",
    });
  }

  async function createApiToken(creds: ApiCredentials, targetMerchantId: string, alias: string): Promise<ApiTokenMetadata> {
    const created = await apiRequest<ApiTokenResponse>(creds, env, {
      method: "POST",
      path: `/merchants/${encodeURIComponent(targetMerchantId)}/apiTokens`,
    }, {
      eventType: "api_token_create",
      entityId: targetMerchantId,
      entityType: "merchant",
    });
    if (!created.ok || created.data.error || !created.data.apiToken?.apiBearerToken) {
      throw new Error(created.data.error?.message ?? "API token was not created or did not return a bearer token.");
    }

    const apiToken = created.data.apiToken;
    if (apiToken.id && alias) {
      const renamed = await updateApiTokenAlias(creds, apiToken.id, alias);
      if (renamed.ok && renamed.data.apiToken) return { ...renamed.data.apiToken, apiBearerToken: apiToken.apiBearerToken };
    }
    return apiToken;
  }

  async function handleListApiTokens() {
    setBusy(true);
    setError(null);
    try {
      await listApiTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to list API tokens.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateAndStoreApiToken() {
    const targetMerchantId = merchantId.trim();
    if (!targetMerchantId) {
      setError("Merchant entity UUID is required.");
      return;
    }
    if (pin.length < 6) {
      setError("PIN is required to encrypt the created token.");
      return;
    }

    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const creds = await requireCreds();
      const alias = `wax_${Date.now()}`;
      const created = await createApiToken(creds, targetMerchantId, alias);
      await saveTransactionToken(env, {
        merchantId: targetMerchantId,
        label: label || created.alias || alias,
        token: created.apiBearerToken ?? "",
        source: "webapi",
        apiTokenId: created.id,
        lastDigits: created.lastDigits,
        state: created.state,
        remoteCreatedTime: created.createdTime,
        remoteLastUsedTime: created.lastUsedTime,
      }, pin);
      await refresh();
      await listApiTokens(targetMerchantId).catch(() => undefined);
      setToken("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create and store API token.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoteTokenAction(apiTokenId: string, action: "suspend" | "activate" | "delete" | "revoke-delete") {
    setBusy(true);
    setError(null);
    try {
      const creds = await requireCreds();
      if (action === "suspend") {
        await suspendApiToken(creds, apiTokenId);
      } else if (action === "activate") {
        await apiRequest<ApiTokenResponse>(creds, env, {
          method: "POST",
          path: `/apiTokens/${encodeURIComponent(apiTokenId)}/activate`,
        }, {
          eventType: "api_token_activate",
          entityId: apiTokenId,
          entityType: "apiToken",
        });
      } else if (action === "delete") {
        await deleteApiToken(creds, apiTokenId);
      } else {
        await suspendApiToken(creds, apiTokenId);
        await deleteApiToken(creds, apiTokenId);
      }
      if (merchantId.trim()) await listApiTokens(merchantId.trim()).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action} API token.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRunExampleTransaction(useTemporaryToken: boolean) {
    setBusy(true);
    setError(null);
    setTransactionResult(null);
    let cleanupCreds: ApiCredentials | null = null;
    let temporaryTokenId: string | undefined;
    try {
      const creds = await requireCreds();
      cleanupCreds = creds;
      const targetMerchantId = merchantId.trim();
      let runToken = tokens.find((row) => row.id === selectedTokenId);

      if (useTemporaryToken) {
        if (!targetMerchantId) throw new Error("Merchant entity UUID is required for temporary token creation.");
        const created = await createApiToken(creds, targetMerchantId, `wax_tmp_${Date.now()}`);
        temporaryTokenId = created.id;
        runToken = {
          id: `temporary-${created.id}`,
          merchantId: targetMerchantId,
          token: created.apiBearerToken ?? "",
          source: "webapi",
          apiTokenId: created.id,
          label: created.alias,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      if (!runToken?.token) throw new Error("Select a saved token or run with a temporary API token.");
      const result = await sendExampleTransaction(env, runToken.token, transactionBody);

      setTransactionResult(redactSecrets({ ...result, temporaryTokenDeleted: !!temporaryTokenId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run example transaction.");
    } finally {
      if (temporaryTokenId && cleanupCreds) {
        await suspendApiToken(cleanupCreds, temporaryTokenId).catch(() => undefined);
        await deleteApiToken(cleanupCreds, temporaryTokenId).catch(() => undefined);
      }
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-200 pt-4 mt-4 space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-slate-600">Transaction tokens</h3>
        <p className="mt-1 text-2xs text-slate-400">
          Merchant-level bearer tokens for transaction tests. Tokens apply to the Merchant level and below; do not store Channel-level tokens here.
        </p>
      </div>

      {tokens.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
          No transaction tokens saved for {env.toUpperCase()}.
        </div>
      ) : (
        <div className="space-y-1">
          {tokens.map((row) => (
            <div key={row.id} className="rounded-md border border-slate-200 p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-slate-700 break-all">{row.merchantId}</div>
                  <div className="mt-0.5 text-2xs text-slate-500">
                    {row.label || "Merchant transaction token"} - {maskToken(row.token)}
                    {row.source === "webapi" ? " - Web API" : " - manual"}
                  </div>
                  <div className="mt-0.5 text-2xs text-slate-400">
                    Updated {new Date(row.updatedAt).toLocaleString()}
                    {row.apiTokenId ? ` - ${row.apiTokenId}` : ""}
                    {row.lastDigits ? ` - ${row.lastDigits}` : ""}
                    {row.state ? ` - ${row.state}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => void handleDelete(row.id)}
                  disabled={busy || pin.length < 6}
                  className="text-2xs font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                  title={pin.length < 6 ? "Enter PIN below before deleting" : "Delete token"}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Merchant entity UUID</label>
          <input
            type="text"
            value={merchantId}
            onChange={(e) => setMerchantId(e.target.value)}
            autoComplete="off"
            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Label</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoComplete="off"
            placeholder="Optional"
            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Bearer token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Encryption PIN</label>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Required to add or delete tokens"
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
      {saved && <p className="text-xs text-emerald-600">Transaction token saved.</p>}

      <button
        onClick={() => void handleSave()}
        disabled={busy}
        className="w-full rounded-md bg-slate-800 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
      >
        {busy ? "Saving..." : "Save transaction token"}
      </button>

      <p className="text-2xs text-slate-400">
        Tokens can be created through Web API token controls or pasted manually from BIP. Raw bearer values stay local and are never shown after saving.
      </p>

      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">API token controls</span>
          <div className="flex gap-1">
            <button
              onClick={() => void handleListApiTokens()}
              disabled={busy || !merchantId.trim()}
              className="rounded-md bg-white px-2 py-1 text-2xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              List
            </button>
            <button
              onClick={() => void handleCreateAndStoreApiToken()}
              disabled={busy || !merchantId.trim() || pin.length < 6}
              className="rounded-md bg-white px-2 py-1 text-2xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50"
            >
              Create and store
            </button>
          </div>
        </div>
        <p className="text-2xs text-slate-500">Extension-created aliases use the wax_ prefix when the API accepts alias updates.</p>
        {apiTokens.length > 0 && (
          <div className="space-y-1">
            {apiTokens.map((apiToken) => (
              <div key={apiToken.id} className="rounded-md border border-slate-200 bg-white p-2 text-2xs text-slate-600">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="break-all font-medium text-slate-700">{apiToken.alias || apiToken.id}</div>
                    <div>{apiToken.state} - {apiToken.lastDigits} - last used {apiToken.lastUsedTime}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => void handleRemoteTokenAction(apiToken.id, "suspend")} disabled={busy} className="text-orange-700 disabled:opacity-50">Suspend</button>
                    <button onClick={() => void handleRemoteTokenAction(apiToken.id, "activate")} disabled={busy} className="text-emerald-700 disabled:opacity-50">Activate</button>
                    <button onClick={() => void handleRemoteTokenAction(apiToken.id, "revoke-delete")} disabled={busy} className="text-red-700 disabled:opacity-50">Revoke</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2">
        <div>
          <h4 className="text-xs font-semibold text-slate-600">Example transaction</h4>
          <p className="mt-1 text-2xs text-slate-500">UAT server-to-server pre-authorization sample. The endpoint and bearer token are supplied internally.</p>
        </div>
        <select
          value={selectedTokenId}
          onChange={(event) => setSelectedTokenId(event.target.value)}
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs"
        >
          <option value="">Select saved token</option>
          {tokens.map((row) => (
            <option key={row.id} value={row.id}>{row.label || row.merchantId} - {maskSecret(row.token)}</option>
          ))}
        </select>
        <textarea
          value={transactionBody}
          onChange={(event) => setTransactionBody(event.target.value)}
          rows={10}
          className="w-full rounded-md border border-slate-200 px-2 py-1.5 font-mono text-2xs"
        />
        <p className="text-2xs text-amber-700">Direct card collection requires PCI-DSS compliance. The sample card body is intended for UAT testing.</p>
        <div className="flex gap-2">
          <button
            onClick={() => void handleRunExampleTransaction(false)}
            disabled={busy || !selectedTokenId}
            className="flex-1 rounded-md bg-slate-800 py-1.5 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            Run with saved token
          </button>
          <button
            onClick={() => void handleRunExampleTransaction(true)}
            disabled={busy || env !== "uat" || !merchantId.trim()}
            className="flex-1 rounded-md bg-orange-600 py-1.5 text-xs font-medium text-white hover:bg-orange-700 disabled:opacity-50"
          >
            Create, run, clean up
          </button>
        </div>
        {env === "prod" && <p className="text-2xs text-red-600">Temporary example transaction creation is disabled for Prod in this slice.</p>}
        {transactionResult !== null && (
          <pre className="max-h-48 overflow-auto rounded-md bg-white p-2 text-2xs text-slate-600">
            {JSON.stringify(transactionResult, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function maskToken(token: string): string {
  if (token.length <= 8) return "masked";
  return `${"*".repeat(8)}${token.slice(-4)}`;
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
              <dt className="text-2xs font-medium uppercase tracking-wide text-slate-400">{row.label}</dt>
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
      <p className="text-2xs text-slate-400">
        Maximum API requests per second for jobs and batch operations (default: 9).
        Higher values may trigger rate limiting.
      </p>
    </div>
  );
}

type GatewayStatusBadge =
  | "disabled"
  | "disabled-but-configured"
  | "ready"
  | "token-locked"
  | "token-missing";

function badgeStyle(status: GatewayStatusBadge) {
  switch (status) {
    case "ready":
      return { label: "Ready", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "token-locked":
      return { label: "Token locked", className: "bg-amber-50 text-amber-700 border-amber-200" };
    case "token-missing":
      return { label: "Token missing", className: "bg-rose-50 text-rose-700 border-rose-200" };
    case "disabled-but-configured":
      return { label: "Disabled but configured", className: "bg-slate-100 text-slate-600 border-slate-200" };
    case "disabled":
    default:
      return { label: "Disabled", className: "bg-slate-50 text-slate-500 border-slate-200" };
  }
}

function GatewaySettingsSection() {
  const [settings, setSettings] = useState<GatewaySettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState(DEFAULT_GATEWAY_HOST);
  const [policyPath, setPolicyPath] = useState(DEFAULT_POLICY_PATH);
  const [telemetryPath, setTelemetryPath] = useState(DEFAULT_TELEMETRY_PATH);
  const [token, setToken] = useState("");
  const [pin, setPin] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [sessionTokenAvailable, setSessionTokenAvailable] = useState(false);
  const [tokenInvalid, setTokenInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const hydrate = async () => {
    const [loaded, stored, sessionToken, invalid] = await Promise.all([
      getGatewaySettings(),
      hasStoredGatewayToken(),
      getGatewaySessionToken(),
      isGatewayTokenInvalid(),
    ]);
    setSettings(loaded);
    setEnabled(loaded.enabled);
    setHost(loaded.host);
    setPolicyPath(loaded.policyPath);
    setTelemetryPath(loaded.telemetryPath);
    setHasToken(stored);
    setSessionTokenAvailable(!!sessionToken);
    setTokenInvalid(invalid);
  };

  useEffect(() => {
    void hydrate();
  }, []);

  const status: GatewayStatusBadge = useMemo(() => {
    if (!settings) return "disabled";
    if (!settings.enabled) {
      return hasToken || settings.host !== DEFAULT_GATEWAY_HOST
        ? "disabled-but-configured"
        : "disabled";
    }
    if (!hasToken) return "token-missing";
    if (tokenInvalid || !sessionTokenAvailable) return "token-locked";
    return "ready";
  }, [hasToken, sessionTokenAvailable, settings, tokenInvalid]);

  const isDirty =
    !!settings &&
    (enabled !== settings.enabled ||
      host.trim() !== settings.host ||
      policyPath.trim() !== settings.policyPath ||
      telemetryPath.trim() !== settings.telemetryPath);

  async function handleSaveSettings() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const saved = await saveGatewaySettings({ enabled, host, policyPath, telemetryPath });
      setSettings(saved);
      setInfo("Settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save gateway settings.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveToken() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await saveGatewayToken(token, pin);
      setToken("");
      setPin("");
      await hydrate();
      setInfo("Gateway token saved and unlocked for this session.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save gateway token.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgetToken() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await forgetGatewayToken();
      await hydrate();
      setInfo("Gateway token forgotten.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to forget gateway token.");
    } finally {
      setBusy(false);
    }
  }

  const badge = badgeStyle(status);

  return (
    <div className="border-t border-slate-200 pt-4 mt-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-600">Governance and telemetry</h3>
        <span className={`text-2xs font-medium px-1.5 py-0.5 rounded border ${badge.className}`}>
          {badge.label}
        </span>
      </div>

      <p className="text-2xs text-slate-500">
        Route tool intent through an MCP gateway for policy evaluation before execution and
        structured telemetry afterwards. Hardened for the Mobot demo; allowed host:
        <code className="ml-1">mobot.laetzer.com</code>.
      </p>

      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable governance hooks
      </label>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Gateway host URL</label>
        <input
          type="url"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder={DEFAULT_GATEWAY_HOST}
          className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Policy path</label>
          <input
            type="text"
            value={policyPath}
            onChange={(e) => setPolicyPath(e.target.value)}
            placeholder={DEFAULT_POLICY_PATH}
            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Telemetry path</label>
          <input
            type="text"
            value={telemetryPath}
            onChange={(e) => setTelemetryPath(e.target.value)}
            placeholder={DEFAULT_TELEMETRY_PATH}
            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      <button
        onClick={handleSaveSettings}
        disabled={busy || !isDirty}
        className="bg-blue-600 text-white text-xs font-medium py-1.5 px-3 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {busy ? "Saving..." : "Save gateway settings"}
      </button>

      <div className="border-t border-slate-100 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-600">Bearer token</h4>
          <span className="text-2xs text-slate-500">
            {hasToken
              ? sessionTokenAvailable
                ? "Saved and unlocked"
                : tokenInvalid
                  ? "Saved but failed to unlock"
                  : "Saved (locked)"
              : "Not saved"}
          </span>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Gateway bearer token
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            placeholder={hasToken ? "Enter to replace existing token" : "Bearer token from Mobot"}
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
            autoComplete="off"
            placeholder="Reuse the PIN you set for ACI credentials"
            className="w-full border border-slate-200 rounded-md px-2 py-1.5 text-xs"
          />
          <p className="text-2xs text-slate-400 mt-1">
            The gateway token is encrypted with the same PIN as your ACI credentials and
            transaction tokens. Unlocking the extension also unlocks the gateway token.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSaveToken}
            disabled={busy || !token || pin.length < 6}
            className="bg-blue-600 text-white text-xs font-medium py-1.5 px-3 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {busy ? "Saving..." : hasToken ? "Replace token" : "Save token"}
          </button>
          {hasToken && (
            <button
              onClick={handleForgetToken}
              disabled={busy}
              className="bg-slate-100 text-slate-700 text-xs font-medium py-1.5 px-3 rounded-md hover:bg-slate-200 disabled:opacity-50 transition-colors"
            >
              Forget token
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {info && !error && <p className="text-xs text-emerald-600">{info}</p>}
    </div>
  );
}
