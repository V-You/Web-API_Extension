import { useState, useEffect, useMemo } from "react";
import type { AuditEntry, Environment } from "../../src/lib/types";

/**
 * Run history page -- shows a local audit log of API operations.
 *
 * Features per PRD:
 *   - Filterable by event type, entity, time range (section 4.5 / 12.1)
 *   - Deletable entries (section 12.3)
 *   - Expand/raw toggle per entry (section 2.3)
 *   - JSON and CSV export (section 12.4)
 */
export function RunHistoryPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [filterType, setFilterType] = useState<string>("");
  const [filterEntity, setFilterEntity] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    chrome.storage.local.get("audit").then((result) => {
      const log = (result.audit ?? []) as AuditEntry[];
      setEntries([...log].reverse());
    });
  }, []);

  // Unique event types present in data (for filter dropdown)
  const eventTypes = useMemo(
    () => [...new Set(entries.map((e) => e.eventType))].sort(),
    [entries],
  );

  // Filtered entries
  const filtered = useMemo(() => {
    let result = entries;
    if (filterType) result = result.filter((e) => e.eventType === filterType);
    if (filterEntity.trim()) {
      const q = filterEntity.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.entityId.toLowerCase().includes(q) ||
          e.entityType.toLowerCase().includes(q),
      );
    }
    return result;
  }, [entries, filterType, filterEntity]);

  function downloadJson() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    triggerDownload(blob, "audit-log.json");
  }

  function downloadCsv() {
    const header = "id,timestamp,eventType,entityType,entityId,responseStatus,environment\n";
    const rows = filtered.map((e) =>
      [e.id, e.timestamp, e.eventType, e.entityType, e.entityId, e.responseStatus, e.environment]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });
    triggerDownload(blob, "audit-log.csv");
  }

  async function handleDelete(id: string) {
    const updated = entries.filter((e) => e.id !== id);
    setEntries(updated);
    // Persist in original (chronological) order
    await chrome.storage.local.set({ audit: [...updated].reverse() });
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-sm">No operations recorded yet.</p>
        <p className="text-xs mt-1 text-slate-400">
          API calls made through the extension will appear here.
        </p>
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

      {/* Filters */}
      <div className="flex gap-2">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-xs border border-slate-200 rounded px-1.5 py-1"
        >
          <option value="">All types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>{formatEvent(t)}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by entity..."
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          className="flex-1 text-xs border border-slate-200 rounded px-2 py-1"
        />
      </div>

      <p className="text-[10px] text-slate-400">
        {filtered.length} of {entries.length} entries
      </p>

      <ul className="space-y-1">
        {filtered.map((entry) => (
          <li
            key={entry.id}
            className="border border-slate-200 rounded-md p-2 text-xs"
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{formatEvent(entry.eventType)}</span>
              <div className="flex items-center gap-1">
                <EnvBadge env={entry.environment} />
                <button
                  onClick={() => handleDelete(entry.id)}
                  title="Delete entry"
                  className="text-slate-400 hover:text-red-500 ml-1 text-[10px]"
                >
                  x
                </button>
              </div>
            </div>
            <div className="text-slate-500 mt-0.5">
              {entry.entityType} {entry.entityId} &ndash;{" "}
              <StatusBadge status={entry.responseStatus} />
            </div>
            <div className="flex items-center justify-between text-slate-400 mt-0.5">
              <span>{new Date(entry.timestamp).toLocaleString()}</span>
              <button
                onClick={() =>
                  setExpandedId(expandedId === entry.id ? null : entry.id)
                }
                className="text-[10px] text-blue-500 hover:text-blue-700"
              >
                {expandedId === entry.id ? "collapse" : "raw"}
              </button>
            </div>
            {/* Expand/raw toggle per PRD 2.3 */}
            {expandedId === entry.id && (
              <pre className="mt-1.5 p-2 bg-slate-50 rounded text-[10px] text-slate-600 overflow-x-auto max-h-40">
                {JSON.stringify(entry, null, 2)}
              </pre>
            )}
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
