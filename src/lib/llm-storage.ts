import { decrypt, encrypt, type EncryptedBlob } from "./crypto";

export type ChatProvider = "gemini";

export interface LlmProviderSettings {
  apiKey: string;
  model: string;
}

export const DEFAULT_CHAT_PROVIDER: ChatProvider = "gemini";
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

const PROVIDERS: ChatProvider[] = [DEFAULT_CHAT_PROVIDER];

const STORAGE_KEY = (provider: ChatProvider) => `llm:${provider}`;
const SESSION_KEY = (provider: ChatProvider) => `session:llm:${provider}`;
const NOTICE_KEY = (provider: ChatProvider) => `llmNotice:${provider}`;
const INVALID_KEY = (provider: ChatProvider) => `llmInvalid:${provider}`;

export async function saveLlmProviderSettings(
  provider: ChatProvider,
  settings: LlmProviderSettings,
  pin: string,
): Promise<void> {
  const blob = await encrypt(pin, JSON.stringify(settings));

  await chrome.storage.local.set({
    [STORAGE_KEY(provider)]: blob,
    [INVALID_KEY(provider)]: false,
  });

  await chrome.storage.session.set({
    [SESSION_KEY(provider)]: settings,
  });
}

export async function getLlmProviderSettings(
  provider: ChatProvider,
): Promise<LlmProviderSettings | null> {
  const result = await chrome.storage.session.get(SESSION_KEY(provider));
  return (result[SESSION_KEY(provider)] as LlmProviderSettings) ?? null;
}

export async function hasStoredLlmProviderSettings(provider?: ChatProvider): Promise<boolean> {
  const keys = provider ? [STORAGE_KEY(provider)] : PROVIDERS.map(STORAGE_KEY);
  const result = await chrome.storage.local.get(keys);
  return keys.some((key) => !!result[key]);
}

export async function forgetLlmProviderSettings(provider: ChatProvider): Promise<void> {
  await chrome.storage.local.remove([STORAGE_KEY(provider), INVALID_KEY(provider)]);
  await chrome.storage.session.remove(SESSION_KEY(provider));
}

export async function hasInvalidLlmProviderSettings(provider: ChatProvider): Promise<boolean> {
  const result = await chrome.storage.local.get(INVALID_KEY(provider));
  return result[INVALID_KEY(provider)] === true;
}

export async function isProviderNoticeDismissed(provider: ChatProvider): Promise<boolean> {
  const result = await chrome.storage.local.get(NOTICE_KEY(provider));
  return result[NOTICE_KEY(provider)] === true;
}

export async function dismissProviderNotice(provider: ChatProvider): Promise<void> {
  await chrome.storage.local.set({
    [NOTICE_KEY(provider)]: true,
  });
}

export async function unlockLlmProviderSettingsWithPin(pin: string): Promise<void> {
  const result = await chrome.storage.local.get(PROVIDERS.map(STORAGE_KEY));

  for (const provider of PROVIDERS) {
    const blob = result[STORAGE_KEY(provider)] as EncryptedBlob | undefined;
    if (!blob) continue;

    try {
      const plaintext = await decrypt(pin, blob);
      const settings = JSON.parse(plaintext) as LlmProviderSettings;
      await Promise.all([
        chrome.storage.session.set({
          [SESSION_KEY(provider)]: settings,
        }),
        chrome.storage.local.set({
          [INVALID_KEY(provider)]: false,
        }),
      ]);
    } catch {
      await Promise.all([
        chrome.storage.local.remove(STORAGE_KEY(provider)),
        chrome.storage.session.remove(SESSION_KEY(provider)),
        chrome.storage.local.set({
          [INVALID_KEY(provider)]: true,
        }),
      ]);
    }
  }
}