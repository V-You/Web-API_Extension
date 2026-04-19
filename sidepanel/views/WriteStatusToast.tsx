/**
 * Post-write status toast display per PRD section 13.1.
 *
 * Shows accepted / pending propagation / verified states after
 * write operations, with a propagation timer.
 */

import { useSyncExternalStore, useEffect, useState } from "react";
import {
  subscribeWriteStatus,
  getWriteStatuses,
  dismissWriteStatus,
  type WriteStatusEntry,
} from "../../src/bridge/write-status";

const PROPAGATION_WINDOW_MS = 180_000;

export function WriteStatusToast() {
  const statuses = useSyncExternalStore(subscribeWriteStatus, getWriteStatuses, getWriteStatuses);
  // Tick every second so elapsed timers update while entries are visible
  const [, tick] = useState(0);
  useEffect(() => {
    if (statuses.length === 0) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [statuses.length]);

  // Auto-dismiss entries after the propagation window expires
  useEffect(() => {
    const stale = statuses.filter((e) => e.status === "pending_propagation" && e.elapsedMs >= PROPAGATION_WINDOW_MS);
    stale.forEach((e) => dismissWriteStatus(e.id));
  }, [statuses]);

  if (statuses.length === 0) return null;

  // Positioned below header (which sits at top of panel) to avoid colliding with chat input and other bottom controls
  return (
    <div className="fixed top-12 right-3 left-3 z-40 space-y-1.5">
      {statuses.map((entry) => (
        <StatusCard key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function StatusCard({ entry }: { entry: WriteStatusEntry }) {
  const { status, description, elapsedMs, id } = entry;

  const styles: Record<string, { bg: string; text: string; label: string }> = {
    accepted: { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", label: "Accepted" },
    pending_propagation: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", label: "Pending propagation" },
    likely_propagated: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-600", label: "Likely propagated" },
    verified: { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", label: "Verified" },
  };

  const s = styles[status] ?? styles.accepted;
  const secs = Math.floor(elapsedMs / 1000);
  const remainingSecs = Math.max(0, 180 - secs);

  return (
    <div className={`${s.bg} border rounded-lg p-2 text-xs flex items-start gap-2`}>
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`font-semibold ${s.text}`}>{s.label}</span>
          {status === "pending_propagation" && (
            <span className="text-amber-500">~{remainingSecs}s remaining</span>
          )}
        </div>
        <p className="text-slate-600 mt-0.5 truncate">{description}</p>
      </div>
      <button
        onClick={() => dismissWriteStatus(id)}
        className="text-slate-400 hover:text-slate-600 text-xs leading-none"
      >
        x
      </button>
    </div>
  );
}
