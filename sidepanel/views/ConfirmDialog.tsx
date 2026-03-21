/**
 * Confirmation dialog overlay.
 *
 * Renders when the confirm bridge has a pending write preview.
 * Shows the operation details and environment badge, with
 * Confirm / Cancel buttons (+ "Confirm all" in sandbox scope).
 */

import { useConfirm } from "../../src/bridge/use-confirm";

export function ConfirmDialog() {
  const { pending, confirm, cancel, confirmAll } = useConfirm();
  if (!pending) return null;

  const { preview, hasScope } = pending;
  const isProd = preview.env === "prod";

  // Filter out empty or internal params
  const displayParams = Object.entries(preview.params).filter(
    ([, v]) => v !== undefined && v !== null && v !== ""
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-[340px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className={`px-4 py-3 border-b flex items-center gap-2 ${
            isProd ? "bg-red-50 border-red-200" : "bg-blue-50 border-blue-200"
          }`}
        >
          <span className="font-semibold text-sm">Confirm write</span>
          <span
            className={`ml-auto text-xs font-medium px-2 py-0.5 rounded-full ${
              isProd ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
            }`}
          >
            {preview.env.toUpperCase()}
          </span>
        </div>

        {/* Body */}
        <div className="px-4 py-3 flex-1 overflow-y-auto text-sm space-y-3">
          {/* Description */}
          <p className="text-slate-800">{preview.description}</p>

          {/* Method + tool badge */}
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`font-mono font-semibold px-1.5 py-0.5 rounded ${
                preview.method === "DELETE"
                  ? "bg-red-100 text-red-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {preview.method}
            </span>
            <span className="text-slate-500">
              {preview.tool} / {preview.action}
            </span>
          </div>

          {/* Parameters */}
          {displayParams.length > 0 && (
            <div className="bg-slate-50 rounded p-2 text-xs font-mono space-y-1 max-h-48 overflow-y-auto">
              {displayParams.map(([key, val]) => (
                <div key={key} className="flex gap-1">
                  <span className="text-slate-500 shrink-0">{key}:</span>
                  <span className="text-slate-800 break-all">
                    {typeof val === "object" ? JSON.stringify(val) : String(val)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-200 flex items-center gap-2">
          <button
            onClick={cancel}
            className="flex-1 px-3 py-1.5 text-xs font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          {hasScope && (
            <button
              onClick={confirmAll}
              className="flex-1 px-3 py-1.5 text-xs font-medium rounded border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors"
            >
              Confirm all
            </button>
          )}
          <button
            onClick={confirm}
            className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded text-white transition-colors ${
              isProd
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
