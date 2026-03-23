import { useState, useEffect } from "react";
import { useCredentialStore } from "../../src/hooks/useCredentialStore";
import { getCredentials } from "../../src/lib/storage";

export function HomePage() {
  const { isUnlocked, activeEnv } = useCredentialStore();
  const [connStatus, setConnStatus] = useState<"checking" | "ok" | "fail" | null>(null);

  // Check connection status when unlocked
  useEffect(() => {
    if (!isUnlocked || !activeEnv) {
      setConnStatus(null);
      return;
    }
    setConnStatus("checking");
    getCredentials(activeEnv).then((creds) => {
      if (!creds) { setConnStatus("fail"); return; }
      fetch(`${creds.baseUrl}/divisions`, {
        method: "GET",
        headers: { credentials: `${creds.username}:${creds.password}` },
      })
        .then((res) => setConnStatus(res.ok ? "ok" : "fail"))
        .catch(() => setConnStatus("fail"));
    });
  }, [isUnlocked, activeEnv]);

  if (!isUnlocked) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-lg font-medium mb-2">Welcome</p>
        <p>
          Go to <strong>Connections</strong> to add your API credentials and get
          started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold">
        Dashboard &ndash; {activeEnv?.toUpperCase()}
      </h2>

      {/* Connection status per PRD 6.1 */}
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`inline-block w-2 h-2 rounded-full ${
            connStatus === "ok"
              ? "bg-green-500"
              : connStatus === "fail"
                ? "bg-red-500"
                : "bg-slate-300 animate-pulse"
          }`}
        />
        <span className="text-slate-500">
          {connStatus === "ok" && "Connected"}
          {connStatus === "fail" && "Connection failed"}
          {connStatus === "checking" && "Checking..."}
          {connStatus === null && "Not connected"}
        </span>
      </div>

      <p className="text-slate-500 text-xs">
        Use the sidebar tools to manage entities, settings, and contacts.
      </p>

      <div className="grid gap-3">
        <QuickAction
          label="Manage entities"
          description="List, create, or edit entities in the hierarchy"
        />
        <QuickAction
          label="View settings"
          description="Read or write settings at any hierarchy level"
        />
        <QuickAction
          label="Manage contacts"
          description="Create, edit, or lock/unlock contact users"
        />
      </div>
    </div>
  );
}

function QuickAction({
  label,
  description,
}: {
  label: string;
  description: string;
}) {
  return (
    <button className="text-left w-full border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition-colors">
      <span className="block text-sm font-medium">{label}</span>
      <span className="block text-xs text-slate-500 mt-0.5">
        {description}
      </span>
    </button>
  );
}
