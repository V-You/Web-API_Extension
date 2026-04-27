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
import { useEffect, useState } from "react";
import {
  getRemoteConfirmRequest,
  sendRemoteConfirmResponse,
  subscribeRemoteConfirmRequest,
  type RemoteConfirmRequest,
} from "./remote-confirm";

export function useConfirm(): {
  pending: PendingConfirmation | null;
  confirm: () => void;
  cancel: () => void;
  confirmAll: () => void;
} {
  const localPending = useSyncExternalStore(subscribe, getPending, getPending);
  const [remotePending, setRemotePending] = useState<RemoteConfirmRequest | null>(null);

  useEffect(() => {
    let active = true;
    getRemoteConfirmRequest().then((next) => {
      if (active) setRemotePending(next);
    }).catch(() => {
      if (active) setRemotePending(null);
    });

    const unsubscribe = subscribeRemoteConfirmRequest(() => {
      getRemoteConfirmRequest().then((next) => {
        if (active) setRemotePending(next);
      }).catch(() => {
        if (active) setRemotePending(null);
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const pending = localPending ?? remotePending;

  const resolveRemote = (choice: "confirm" | "cancel" | "confirm_all") => {
    if (!remotePending) return;
    void sendRemoteConfirmResponse(remotePending.requestId, choice).then(() => {
      setRemotePending(null);
    });
  };

  return {
    pending,
    confirm: () => (remotePending ? resolveRemote("confirm") : resolveConfirm("confirm")),
    cancel: () => (remotePending ? resolveRemote("cancel") : resolveConfirm("cancel")),
    confirmAll: () => (remotePending ? resolveRemote("confirm_all") : resolveConfirm("confirm_all")),
  };
}
