import { useState, useEffect } from "react";
import {
  Home as HomeIcon,
  MessageSquare,
  Activity,
  History as HistoryIcon,
  Plug,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { useCredentialStore } from "../src/hooks/useCredentialStore";
import { useActiveJobId, useJobs } from "../src/jobs/use-jobs";
import { useConnectionStatus } from "./hooks/useConnectionStatus";
import { HomePage } from "./views/HomePage";
import { ConnectionsPage } from "./views/ConnectionsPage";
import { ChatPage } from "./views/ChatPage";
import { RunHistoryPage } from "./views/RunHistoryPage";
import { PinEntryPage } from "./views/PinEntryPage";
import { ConfirmDialog } from "./views/ConfirmDialog";
import { JobMonitor } from "./views/JobMonitor";
import { WriteStatusToast } from "./views/WriteStatusToast";
import type { Environment } from "../src/lib/types";

type View = "home" | "chat" | "jobs" | "history" | "connections";

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
      <main className="flex-1 overflow-y-auto p-3">
        {view === "home" && <HomePage />}
        {view === "connections" && (
          <ConnectionsPage onChanged={() => checkState()} />
        )}
        {/* Keep ChatPage mounted so conversation state survives tab switches */}
        <div className={view === "chat" ? "h-full" : "hidden"}>
          <ChatPage />
        </div>
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
      <Lock className="w-8 h-8 text-slate-400 mb-3" aria-hidden="true" />
      <h2 className="text-sm font-semibold text-slate-700 mb-1">Domain not supported</h2>
    </div>
  );
}

const TAB_ORDER: ReadonlyArray<{ id: View; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "jobs", label: "Jobs", icon: Activity },
  { id: "history", label: "History", icon: HistoryIcon },
  { id: "connections", label: "Connections", icon: Plug },
];

const VIEW_LABELS: Record<View, string> = Object.fromEntries(
  TAB_ORDER.map((t) => [t.id, t.label]),
) as Record<View, string>;

function Header({ view, activeEnv }: { view: View; activeEnv: Environment | null }) {
  const { status } = useConnectionStatus();
  const _connectionLabel =
    status === "ok"
      ? "Connected"
      : status === "fail"
        ? "Not connected"
        : status === "checking"
          ? "Checking connection"
          : "Connection idle";
  const _dotClass =
    status === "ok"
      ? "bg-emerald-500"
      : status === "fail"
        ? "bg-red-500"
        : "bg-slate-300 animate-pulse";

  return (
    <header className="flex items-center justify-between px-3 py-2 border-b border-slate-200">
      <div className="flex items-center gap-2">
        <span className="font-semibold text-sm">{VIEW_LABELS[view]}</span>
        {/*<span
          role="status"
          aria-label={connectionLabel}
          title={connectionLabel}
          className={`inline-block w-2 h-2 rounded-full ${dotClass}`}
        />*/}
      </div>
      {activeEnv && (
        <span
          aria-label={activeEnv === "prod" ? "Production environment" : "UAT environment"}
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
  const activeJobId = useActiveJobId();
  const jobs = useJobs();
  // Badge on Jobs tab when any job is running, paused, or resumed (recoverable).
  const jobsBadge =
    activeJobId !== null ||
    jobs.some((j) => j.state === "running" || j.state === "paused" || j.state === "resumed");

  return (
    <nav className="flex border-t border-slate-200">
      {TAB_ORDER.map((tab) => {
        const Icon = tab.icon;
        const isActive = current === tab.id;
        const showBadge = tab.id === "jobs" && jobsBadge && !isActive;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? "page" : undefined}
            aria-label={tab.label}
            className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset ${
              isActive
                ? "text-blue-600 bg-blue-50"
                : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
            }`}
          >
            <span className="relative">
              <Icon className="w-4 h-4" aria-hidden="true" />
              {showBadge && (
                <span
                  aria-label="Active job"
                  className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-blue-500"
                />
              )}
            </span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
