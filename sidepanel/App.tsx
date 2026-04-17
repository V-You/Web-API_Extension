import { useState, useEffect } from "react";
import { useCredentialStore } from "../src/hooks/useCredentialStore";
import { HomePage } from "./views/HomePage";
import { ConnectionsPage } from "./views/ConnectionsPage";
import { ChatPage } from "./views/ChatPage";
import { RunHistoryPage } from "./views/RunHistoryPage";
import { PinEntryPage } from "./views/PinEntryPage";
import { ConfirmDialog } from "./views/ConfirmDialog";
import { JobMonitor } from "./views/JobMonitor";
import { PrivacyNotice } from "./views/PrivacyNotice";
import { WriteStatusToast } from "./views/WriteStatusToast";
import type { Environment } from "../src/lib/types";

type View = "home" | "connections" | "history" | "jobs" | "chat";

const OPPWA_PATTERN = /^https:\/\/eu-(test|prod)\.oppwa\.com(\/|$)/;

/** Hook that tracks whether the active tab is on a supported domain. */
function useDomainGate(): { onScopedDomain: boolean | null } {
  const [onScopedDomain, setOnScopedDomain] = useState<boolean | null>(null);

  useEffect(() => {
    function checkActiveTab() {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = tabs?.[0]?.url ?? "";
        setOnScopedDomain(OPPWA_PATTERN.test(url));
      });
    }
    checkActiveTab();

    // Re-check when the user switches tabs or navigates
    const onActivated = () => checkActiveTab();
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.url || changeInfo.status === "complete") checkActiveTab();
    };

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return { onScopedDomain };
}

export function App() {
  const [view, setView] = useState<View>("home");
  const { isInitialized, isUnlocked, activeEnv, checkState } =
    useCredentialStore();
  const { onScopedDomain } = useDomainGate();

  useEffect(() => {
    checkState();
  }, [checkState]);

  // Still loading tab info
  if (onScopedDomain === null) return null;

  // Not on a supported domain
  if (!onScopedDomain) {
    return <DomainGateScreen />;
  }

  // If credentials exist but session is locked, show PIN entry
  if (isInitialized && !isUnlocked) {
    return <PinEntryPage onUnlocked={() => checkState()} />;
  }

  return (
    <div className="flex flex-col h-screen">
      <Header view={view} activeEnv={activeEnv} />
      <PrivacyNotice />
      <main className="flex-1 overflow-y-auto p-3">
        {view === "home" && <HomePage />}
        {view === "connections" && (
          <ConnectionsPage onChanged={() => checkState()} />
        )}
        {view === "chat" && <ChatPage />}
        {view === "history" && <RunHistoryPage />}
        {view === "jobs" && <JobMonitor />}
      </main>
      <Nav current={view} onChange={setView} />
      <WriteStatusToast />
      <ConfirmDialog />
    </div>
  );
}

function DomainGateScreen() {
  return (
    <div className="flex flex-col items-center justify-center h-screen px-6 text-center">
      <span className="text-3xl mb-3">&#128274;</span>
      <h2 className="text-sm font-semibold text-slate-700 mb-1">Domain not supported</h2>
    </div>
  );
}

const VIEW_LABELS: Record<View, string> = {
  home: "Home",
  jobs: "Jobs",
  history: "History",
  chat: "Chat",
  connections: "Connections",
};

function Header({ view, activeEnv }: { view: View; activeEnv: Environment | null }) {
  return (
    <header className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
      <span className="font-semibold text-sm">{VIEW_LABELS[view]}</span>
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
  const tabs = (Object.keys(VIEW_LABELS) as View[]).map((id) => ({
    id,
    label: VIEW_LABELS[id],
  }));

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
