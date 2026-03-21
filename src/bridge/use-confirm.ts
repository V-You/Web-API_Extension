/**
 * React hook for the confirmation bridge.
 * Uses useSyncExternalStore for tear-free reads.
 */

import { useSyncExternalStore } from "react";
import {
  subscribe,
  getPending,
  resolveConfirm,
  type PendingConfirmation,
} from "./confirm-bridge";

export function useConfirm(): {
  pending: PendingConfirmation | null;
  confirm: () => void;
  cancel: () => void;
  confirmAll: () => void;
} {
  const pending = useSyncExternalStore(subscribe, getPending, getPending);

  return {
    pending,
    confirm: () => resolveConfirm("confirm"),
    cancel: () => resolveConfirm("cancel"),
    confirmAll: () => resolveConfirm("confirm_all"),
  };
}
