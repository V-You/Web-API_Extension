import { useState } from "react";
import { forgetCredentials, unlockWithPin } from "../../src/lib/storage";

interface Props {
  onUnlocked: () => void;
}

export function PinEntryPage({ onUnlocked }: Props) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin) return;

    setBusy(true);
    setError(null);
    try {
      const ok = await unlockWithPin(pin);
      if (ok) {
        onUnlocked();
      } else {
        setError("Incorrect PIN. Please try again.");
        setPin("");
      }
    } catch {
      setError("Failed to unlock. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    setBusy(true);
    try {
      await Promise.all([forgetCredentials("uat"), forgetCredentials("prod")]);
      // Reload so App re-evaluates credential state from scratch
      window.location.reload();
    } catch {
      setError("Failed to reset credentials.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen px-6">
      <div className="w-full max-w-xs space-y-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Web API Extension</h1>
          <p className="text-xs text-slate-500 mt-1">
            Enter your PIN to unlock stored credentials.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="PIN"
            autoFocus
            className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm text-center tracking-widest"
          />
          {error && <p className="text-xs text-red-600 text-center">{error}</p>}
          <button
            type="submit"
            disabled={busy || !pin}
            className="w-full bg-blue-600 text-white text-sm font-medium py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {busy ? "Unlocking..." : "Unlock"}
          </button>
        </form>

        <div className="text-center">
          {confirmReset ? (
            <div className="space-y-2">
              <p className="text-2xs text-slate-500">
                This will erase all saved credentials for UAT and PROD.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleReset}
                  disabled={busy}
                  className="text-2xs text-red-600 underline hover:text-red-700 disabled:opacity-50"
                >
                  Confirm reset
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  disabled={busy}
                  className="text-2xs text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="text-2xs text-slate-400 underline hover:text-slate-600"
            >
              Reset PIN (clear all credentials)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
