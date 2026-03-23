import { useState, useEffect } from "react";
import type { AuditEntry, Environment } from "../../src/lib/types";

/**
 * Run history page -- shows a local audit log of API operations.
 * Data is stored in chrome.storage.local under the "audit" key.
 */
export function RunHistoryPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    chrome.storage.local.get("audit").then((result) => {
      const log = (result.audit ?? []) as AuditEntry[];
      // Show newest first
      setEntries([...log].reverse());
    });
  }, []);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: "application/json" });
    triggerDownload(blob, "audit-log.json");
  }

  function downloadCsv() {
    const header = "id,timestamp,eventType,entityType,entityId,responseStatus,environment\n";
    const rows = entries.map((e) =>
      [e.id, e.timestamp, e.eventType, e.entityType, e.entityId, e.responseStatus, e.environment]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    triggerDownload(blob, "audit-log.csv");
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-sm">No operations recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Run history</h2>
        <div className="flex gap-1">
          <button
            onClick={downloadJson}
            className="text-[10px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-1.5 py-0.5"
          >
            JSON
          </button>
          <button
            onClick={downloadCsv}
            className="text-[10px] text-slate-500 hover:text-slate-700 border border-slate-200 rounded px-1.5 py-0.5"
          >
            CSV
          </button>
        </div>
      </div>
      <ul className="space-y-1">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="border border-slate-200 rounded-md p-2 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{formatEvent(entry.eventType)}</span>
              <EnvBadge env={entry.environment} />
            </div>
            <div className="text-slate-500 mt-0.5">
              {entry.entityType} {entry.entityId} &ndash;{" "}
              <StatusBadge status={entry.responseStatus} />
            </div>
            <div className="text-slate-400 mt-0.5">
              {new Date(entry.timestamp).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EnvBadge({ env }: { env: Environment }) {
  return (
    <span
      className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
        env === "prod"
          ? "bg-red-100 text-red-700"
          : "bg-blue-100 text-blue-700"
      }`}
    >
      {env.toUpperCase()}
    </span>
  );
}

function StatusBadge({ status }: { status: number }) {
  const ok = status >= 200 && status < 300;
  return (
    <span className={ok ? "text-green-600" : "text-red-600"}>
      {status}
    </span>
  );
}

function formatEvent(eventType: string): string {
  return eventType
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
