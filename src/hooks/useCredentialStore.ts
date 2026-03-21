import { useCallback, useEffect, useState } from "react";
import type { Environment } from "../lib/types";
import {
  hasStoredCredentials,
  isSessionUnlocked,
  getActiveEnv,
} from "../lib/storage";

interface CredentialStoreState {
  /** True when at least one encrypted credential blob exists. */
  isInitialized: boolean;
  /** True when decrypted credentials are available in session. */
  isUnlocked: boolean;
  /** The currently active environment (null if none selected). */
  activeEnv: Environment | null;
  /** Re-check the storage state (call after unlock / save / forget). */
  checkState: () => Promise<void>;
}

export function useCredentialStore(): CredentialStoreState {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [activeEnv, setActiveEnv] = useState<Environment | null>(null);

  const checkState = useCallback(async () => {
    const [init, unlocked, env] = await Promise.all([
      hasStoredCredentials(),
      isSessionUnlocked(),
      getActiveEnv(),
    ]);
    setIsInitialized(init);
    setIsUnlocked(unlocked);
    setActiveEnv(env);
  }, []);

  useEffect(() => {
    checkState();
  }, [checkState]);

  return { isInitialized, isUnlocked, activeEnv, checkState };
}
