import { useState, useEffect } from "react";
import { useCredentialStore } from "@/hooks/useCredentialStore";
import { HomePage } from "./views/HomePage";
import { ConnectionsPage } from "./views/ConnectionsPage";
import { RunHistoryPage } from "./views/RunHistoryPage";
import { PinEntryPage } from "./views/PinEntryPage";
import type { Environment } from "@/lib/types";

type View = "home" | "connections" | "history";

export function App() {
  const [view, setView] = useState<View>("home");
  const { isInitialized, isUnlocked, activeEnv, checkState } =
    useCredentialStore();

  useEffect(() => {
    checkState();
  }, [checkState]);

  // If credentials exist but session is locked, show PIN entry
  if (isInitialized && !isUnlocked) {
    return <PinEntryPage onUnlocked={() => checkState()} />;
  }

  return (
    <div className="flex flex-col h-screen">
      <Header activeEnv={activeEnv} />
      <main className="flex-1 overflow-y-auto p-3">
        {view === "home" && <HomePage />}
        {view === "connections" && (
          <ConnectionsPage onChanged={() => checkState()} />
        )}
        {view === "history" && <RunHistoryPage />}
      </main>
      <Nav current={view} onChange={setView} />
    </div>
  );
}

function Header({ activeEnv }: { activeEnv: Environment | null }) {
  return (
    <header className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
      <span className="font-semibold text-sm">Web API Extension</span>
      {activeEnv && (
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            activeEnv === "prod"
              ? "bg-red-100 text-red-700"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {activeEnv.toUpperCase()}
        </span>
      )}
    </header>
  );
}

function Nav({
  current,
  onChange,
}: {
  current: View;
  onChange: (v: View) => void;
}) {
  const tabs: { id: View; label: string }[] = [
    { id: "home", label: "Home" },
    { id: "history", label: "History" },
    { id: "connections", label: "Connections" },
  ];

  return (
    <nav className="flex border-t border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            current === tab.id
              ? "text-blue-600 border-t-2 border-blue-600 -mt-px"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
