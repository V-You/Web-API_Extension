/**
 * One-time privacy notice per PRD section 11.1.
 *
 * Informs the user that chat content and tool results are available
 * to their configured LLM provider. Dismissible, persisted to storage.
 */

import { useState, useEffect } from "react";
import { isPrivacyNoticeDismissed, dismissPrivacyNotice } from "../../src/lib/storage";

export function PrivacyNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    isPrivacyNoticeDismissed().then((dismissed) => {
      if (!dismissed) setVisible(true);
    });
  }, []);

  if (!visible) return null;

  function handleDismiss() {
    dismissPrivacyNotice();
    setVisible(false);
  }

  return (
    <div className="mx-3 mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
      <p>
        Chat content and tool results will be available to your configured LLM
        provider. Use a local model if data sovereignty is required.
      </p>
      <button
        onClick={handleDismiss}
        className="mt-2 text-amber-700 font-medium hover:text-amber-900 underline underline-offset-2"
      >
        Understood, dismiss
      </button>
    </div>
  );
}
