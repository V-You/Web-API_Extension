/**
 * Post-write status toast display per PRD section 13.1.
 *
 * Shows accepted / pending propagation / verified states after
 * write operations, with a propagation timer.
 */

import { useSyncExternalStore } from "react";
import {
  subscribeWriteStatus,
  getWriteStatuses,
  dismissWriteStatus,
  type WriteStatusEntry,
} from "../../src/bridge/write-status";

export function WriteStatusToast() {
  const statuses = useSyncExternalStore(subscribeWriteStatus, getWriteStatuses, getWriteStatuses);

  if (statuses.length === 0) return null;

  return (
    <div className="fixed bottom-16 right-3 left-3 z-40 space-y-1.5">
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
    verified: { bg: "bg-green-50 border-green-200", text: "text-green-700", label: "Verified" },
  };

  const s = styles[status] ?? styles.accepted;
  const secs = Math.floor(elapsedMs / 1000);

  return (
    <div className={`${s.bg} border rounded-lg p-2 text-xs flex items-start gap-2`}>
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`font-semibold ${s.text}`}>{s.label}</span>
          {status === "pending_propagation" && (
            <span className="text-amber-500">{secs}s</span>
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
