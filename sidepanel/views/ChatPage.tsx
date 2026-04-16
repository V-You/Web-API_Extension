import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntityType } from "../../src/lib/entity-types";
import { CHAT_WRITE_TOOLS_KEY, isChatWriteToolsEnabled, setChatWriteToolsEnabled } from "../../src/chat/chat-mode";
import {
  DEFAULT_CHAT_PROVIDER,
  DEFAULT_GEMINI_MODEL,
  dismissProviderNotice,
  forgetLlmProviderSettings,
  getLlmProviderSettings,
  hasInvalidLlmProviderSettings,
  isProviderNoticeDismissed,
  saveLlmProviderSettings,
  type LlmProviderSettings,
} from "../../src/lib/llm-storage";
import { buildChatSystemPrompt, CHAT_DISCOVERY_PROMPT_CHIPS } from "../../src/chat/discovery-playbook";
import { getActiveChatContext, getActiveBipTabId, type ChatContextRecord } from "../../src/chat/context-store";
import { executeChatTool, getChatToolDeclarations } from "../../src/chat/tool-bridge";
import { runGeminiTurn, type GeminiContent } from "../../src/chat/adapters/gemini";

type DisplayMessage =
  | { id: string; role: "user" | "assistant"; text: string }
  | { id: string; role: "tool"; toolName: string; args: Record<string, unknown>; result: unknown };

function humanizeContextSection(section: string | undefined): string | null {
  if (!section) return null;

  switch (section) {
    case "attachedMerchantAccounts":
      return "attached merchant accounts";
    case "ownedMerchantAccounts":
      return "owned merchant accounts";
    case "merchantAccounts":
      return "merchant accounts";
    case "attachedContacts":
      return "attached contacts";
    case "ownedContacts":
      return "owned contacts";
    default:
      return section.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  }
}

export function ChatPage() {
  const [history, setHistory] = useState<GeminiContent[]>([]);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savedSettings, setSavedSettings] = useState<LlmProviderSettings | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [modelInput, setModelInput] = useState(DEFAULT_GEMINI_MODEL);
  const [pinInput, setPinInput] = useState("");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null);
  const [noticeDismissed, setNoticeDismissed] = useState(true);
  const [detectedContext, setDetectedContext] = useState<ChatContextRecord | null>(null);
  const [manualEntityType, setManualEntityType] = useState<EntityType>("merchant");
  const [manualEntityId, setManualEntityId] = useState("");
  const [writeToolsEnabled, setWriteToolsEnabledState] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);

  const refreshContext = useCallback(async () => {
    const context = await getActiveChatContext();
    setDetectedContext(context);
  }, []);

  useEffect(() => {
    getLlmProviderSettings(DEFAULT_CHAT_PROVIDER).then((settings) => {
      setSavedSettings(settings);
      setModelInput(settings?.model ?? DEFAULT_GEMINI_MODEL);
    });
    hasInvalidLlmProviderSettings(DEFAULT_CHAT_PROVIDER).then((invalid) => {
      setSettingsWarning(
        invalid
          ? "Saved Gemini settings could not be unlocked with the current PIN and were cleared. Re-enter the API key to continue."
          : null,
      );
    });
    isChatWriteToolsEnabled().then(setWriteToolsEnabledState);
    isProviderNoticeDismissed(DEFAULT_CHAT_PROVIDER).then(setNoticeDismissed);
    refreshContext();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session") {
        if (changes[CHAT_WRITE_TOOLS_KEY]) {
          setWriteToolsEnabledState(changes[CHAT_WRITE_TOOLS_KEY].newValue === true);
        }
        void refreshContext();
      }
      if (area === "local" && changes["llmNotice:gemini"]) {
        void isProviderNoticeDismissed(DEFAULT_CHAT_PROVIDER).then(setNoticeDismissed);
      }
      if (area === "local" && changes["llmInvalid:gemini"]) {
        void hasInvalidLlmProviderSettings(DEFAULT_CHAT_PROVIDER).then((invalid) => {
          setSettingsWarning(
            invalid
              ? "Saved Gemini settings could not be unlocked with the current PIN and were cleared. Re-enter the API key to continue."
              : null,
          );
        });
      }
    };

    const handleTabChange = () => {
      void refreshContext();
    };

    const handleTabUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (changeInfo.status === "complete" || changeInfo.url) {
        void refreshContext();
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);
    chrome.tabs.onActivated.addListener(handleTabChange);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
      chrome.tabs.onActivated.removeListener(handleTabChange);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
    };
  }, [refreshContext]);

  const effectiveContext = useMemo(() => {
    if (manualEntityId.trim()) {
      return {
        entityId: manualEntityId.trim(),
        entityType: manualEntityType,
        source: "manual" as const,
      };
    }

    if (detectedContext) {
      return {
        entityId: detectedContext.entityId,
        entityType: detectedContext.entityType,
        source: "detected" as const,
      };
    }

    return null;
  }, [detectedContext, manualEntityId, manualEntityType]);

  const contextState = effectiveContext?.source ?? "missing";

  async function handleSaveSettings() {
    const apiKey = apiKeyInput.trim() || savedSettings?.apiKey;
    if (!apiKey) {
      setSettingsError("Gemini API key is required.");
      return;
    }
    if (!pinInput) {
      setSettingsError("PIN is required to save provider settings.");
      return;
    }

    setSettingsBusy(true);
    setSettingsError(null);
    try {
      const settings = {
        apiKey,
        model: modelInput.trim() || DEFAULT_GEMINI_MODEL,
      };
      await saveLlmProviderSettings(DEFAULT_CHAT_PROVIDER, settings, pinInput);
      setSavedSettings(settings);
      setSettingsWarning(null);
      setApiKeyInput("");
      setPinInput("");
      setSettingsOpen(false);
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : "Failed to save Gemini settings.");
    } finally {
      setSettingsBusy(false);
    }
  }

  async function handleForgetSettings() {
    await forgetLlmProviderSettings(DEFAULT_CHAT_PROVIDER);
    setSavedSettings(null);
    setSettingsWarning(null);
    setApiKeyInput("");
    setModelInput(DEFAULT_GEMINI_MODEL);
    setPinInput("");
  }

  async function handleDismissNotice() {
    await dismissProviderNotice(DEFAULT_CHAT_PROVIDER);
    setNoticeDismissed(true);
  }

  async function handleToggleWriteTools() {
    const next = !writeToolsEnabled;

    setModeBusy(true);
    setError(null);
    try {
      await setChatWriteToolsEnabled(next);
      setWriteToolsEnabledState(next);
      setHistory([]);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: next
            ? "Write tools are enabled for this browser session. New prompts may request confirmation before making changes."
            : "Write tools are disabled. Chat is back in safe mode for new prompts.",
        },
      ]);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update chat mode.");
    } finally {
      setModeBusy(false);
    }
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    if (!savedSettings?.apiKey) {
      setError("Save Gemini settings first.");
      setSettingsOpen(true);
      return;
    }
    if (!noticeDismissed) {
      setError("Review and dismiss the Gemini privacy notice before sending a prompt.");
      return;
    }

    setBusy(true);
    setError(null);
    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");

    const contextText = effectiveContext
        ? [
            `Current dashboard context: ${effectiveContext.entityType} ${effectiveContext.entityId}${detectedContext?.entityName ? ` (${detectedContext.entityName})` : ""}.`,
            detectedContext?.section ? `Current BIP section: ${detectedContext.section}.` : null,
            "Use this as the default target unless the user says otherwise.",
          ].filter(Boolean).join(" ")
      : "No dashboard context is available. Ask for explicit entity identifiers when needed.";

    try {
      const result = await runGeminiTurn({
        apiKey: savedSettings.apiKey,
        model: savedSettings.model,
        history,
        userText: `${contextText}\n\nUser request: ${trimmed}`,
        systemPrompt: buildChatSystemPrompt({ writeToolsEnabled }),
        tools: getChatToolDeclarations({ writeToolsEnabled }),
        executeTool: (name, args) => executeChatTool(name, args, { writeToolsEnabled }),
      });

      setHistory(result.history);
      setMessages((current) => [
        ...current,
        ...result.toolEvents.map((event) => ({
          id: `tool-${event.id}`,
          role: "tool" as const,
          toolName: event.name,
          args: event.args,
          result: event.result,
        })),
        {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          text: result.assistantText,
        },
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Chat request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">Chat</h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
          writeToolsEnabled
            ? "bg-amber-50 text-amber-700"
            : "bg-emerald-50 text-emerald-700"
        }`}>
          {writeToolsEnabled ? "Write tools enabled" : "Safe mode"}
        </span>
        <button
          onClick={() => setSettingsOpen((open) => !open)}
          className="ml-auto text-xs text-slate-500 hover:text-slate-700"
        >
          Settings
        </button>
      </div>

      <p className="text-xs text-slate-500">
        {writeToolsEnabled
          ? "Write tools are enabled for this browser session. Use chat for scoped changes, but every write still requires explicit confirmation."
          : "Read-only by default, but built for discovery: inspect hierarchy, settings, contacts, merchant accounts, and risk configuration from the current entity."}
      </p>

      <div className={`rounded-md border p-3 text-xs ${
        writeToolsEnabled
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="font-medium">
              {writeToolsEnabled ? "Write tools are enabled for this browser session." : "Safe mode is active by default."}
            </p>
            <p>
              {writeToolsEnabled
                ? "Mutating tools are now available in chat, but the existing preview-confirm flow still runs before any change is executed."
                : "Chat can inspect and reason over the current SaaS context, but it will not attempt writes until you explicitly enable them for this browser session."}
            </p>
          </div>
          <button
            onClick={() => void handleToggleWriteTools()}
            disabled={modeBusy || busy}
            className={`rounded-md px-3 py-1.5 font-medium disabled:opacity-50 ${
              writeToolsEnabled
                ? "bg-white text-amber-700 hover:bg-amber-100"
                : "bg-white text-emerald-700 hover:bg-emerald-100"
            }`}
          >
            {modeBusy
              ? "Updating..."
              : writeToolsEnabled
                ? "Disable write tools"
                : "Enable write tools"}
          </button>
        </div>
      </div>

      {settingsWarning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {settingsWarning}
        </div>
      )}

      {!noticeDismissed && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <p>
            Prompts and tool results for this chat will be sent to Gemini. API credentials are never shared.
          </p>
          <button
            onClick={handleDismissNotice}
            className="mt-2 font-medium text-amber-700 underline underline-offset-2"
          >
            Understood
          </button>
        </div>
      )}

      {settingsOpen && (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
          <div>
            <label className="mb-1 block font-medium text-slate-600">Provider</label>
            <select className="w-full rounded-md border border-slate-200 px-2 py-1.5" value="gemini" disabled>
              <option value="gemini">Gemini</option>
              <option value="anthropic">Anthropic (planned)</option>
              <option value="openai">OpenAI (planned)</option>
              <option value="ollama">Ollama (planned)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block font-medium text-slate-600">Gemini API key</label>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder={savedSettings ? "Leave blank to keep the saved key" : "AI..."}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5"
            />
          </div>
          <div>
            <label className="mb-1 block font-medium text-slate-600">Model</label>
            <input
              type="text"
              value={modelInput}
              onChange={(event) => setModelInput(event.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-1.5"
            />
          </div>
          <div>
            <label className="mb-1 block font-medium text-slate-600">PIN</label>
            <input
              type="password"
              value={pinInput}
              onChange={(event) => setPinInput(event.target.value)}
              placeholder="Required to encrypt the Gemini key"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5"
            />
          </div>
          {settingsError && <p className="text-red-600">{settingsError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void handleSaveSettings()}
              disabled={settingsBusy}
              className="rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {settingsBusy ? "Saving..." : "Save Gemini settings"}
            </button>
            {savedSettings && (
              <button
                onClick={() => void handleForgetSettings()}
                className="rounded-md px-3 py-1.5 text-red-600 hover:text-red-700"
              >
                Remove
              </button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-600">Context</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-slate-500 border border-slate-200">
            {contextState}
          </span>
        </div>
        {detectedContext ? (
          <p className="text-slate-700">
            Detected: {detectedContext.entityType} {detectedContext.entityId}
            {detectedContext.entityName ? ` (${detectedContext.entityName})` : ""}
          </p>
        ) : (
          <p className="text-slate-500">No entity detected from the current BIP tab.</p>
        )}
        {detectedContext?.section && (
          <p className="text-slate-500">
            Current section: {humanizeContextSection(detectedContext.section)}
          </p>
        )}
        <p className="text-slate-500">
          Tip: ask in UI language such as "plausibility checks", "dupe check", "blacklist", or "3DS" -- chat should resolve those labels to the underlying settings.
        </p>
        <div className="flex gap-2">
          <select
            value={manualEntityType}
            onChange={(event) => setManualEntityType(event.target.value as EntityType)}
            className="rounded-md border border-slate-200 px-2 py-1.5"
          >
            <option value="psp">PSP</option>
            <option value="division">Division</option>
            <option value="merchant">Merchant</option>
            <option value="channel">Channel</option>
          </select>
          <input
            type="text"
            value={manualEntityId}
            onChange={(event) => setManualEntityId(event.target.value)}
            placeholder="Manual entity ID override"
            className="flex-1 rounded-md border border-slate-200 px-2 py-1.5"
          />
          <button
            onClick={async () => {
              const tabId = await getActiveBipTabId();
              if (!tabId) return;
              const context = await getActiveChatContext();
              if (context) {
                setManualEntityType(context.entityType);
                setManualEntityId(context.entityId);
              }
            }}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-slate-600 hover:bg-white"
          >
            Use detected
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CHAT_DISCOVERY_PROMPT_CHIPS.map((chip) => (
          <button
            key={chip}
            onClick={() => setInput(chip)}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3 min-h-[260px] max-h-[420px] overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500">
            {writeToolsEnabled
              ? "Ask about the current entity, inspect configuration, or request a scoped change that can go through confirmation."
              : "Ask a read-only question about the current entity, its settings, hierarchy, contacts, or merchant accounts."}
          </p>
        ) : (
          messages.map((message) => {
            if (message.role === "tool") {
              return (
                <details key={message.id} className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
                  <summary className="cursor-pointer font-medium text-slate-700">
                    tool: {message.toolName}
                  </summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-[11px] text-slate-600">
{JSON.stringify({ args: message.args, result: message.result }, null, 2)}
                  </pre>
                </details>
              );
            }

            return (
              <div
                key={message.id}
                className={`rounded-md px-3 py-2 text-sm whitespace-pre-wrap ${
                  message.role === "user"
                    ? "ml-8 bg-blue-50 text-blue-900"
                    : "mr-8 bg-slate-50 text-slate-800"
                }`}
              >
                {message.text}
              </div>
            );
          })
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={writeToolsEnabled
            ? "Ask about the current entity or request a confirmed change..."
            : "Ask a read-only question about the current entity..."}
          rows={3}
          className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => void handleSend()}
          disabled={busy || !input.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send"}
        </button>
      </div>
    </div>
  );
}