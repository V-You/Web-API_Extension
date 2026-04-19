import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntityType } from "../../src/lib/entity-types";
import {
  CHAT_RENDER_MARKDOWN_KEY,
  CHAT_SHOW_TOOL_TRACES_KEY,
  CHAT_WRITE_TOOLS_KEY,
  isChatRenderMarkdownEnabled,
  isChatShowToolTracesEnabled,
  isChatWriteToolsEnabled,
  setChatRenderMarkdownEnabled,
  setChatShowToolTracesEnabled,
  setChatWriteToolsEnabled,
} from "../../src/chat/chat-mode";
import { AssistantMarkdown } from "../components/AssistantMarkdown";
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
import { buildChatSystemPrompt } from "../../src/chat/discovery-playbook";
import { getActiveChatContext, type ChatContextRecord } from "../../src/chat/context-store";
import { summarizeToolResources } from "../../src/chat/tool-provenance";
import { executeChatTool, getChatToolDeclarations } from "../../src/chat/tool-bridge";
import { runGeminiTurn, type GeminiContent } from "../../src/chat/adapters/gemini";

type DisplayMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; consultedResources?: string[] }
  | { id: string; role: "tool"; toolName: string; args: Record<string, unknown>; result: unknown };

const CURATED_CHIPS = [
  "What entity is this?",
  "What is the dupe check set to?",
  "List all users",
];

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
  const [renderMarkdown, setRenderMarkdownState] = useState(true);
  const [showToolTraces, setShowToolTracesState] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [autoUseContext, setAutoUseContext] = useState(true);
  const [showManualOverride, setShowManualOverride] = useState(false);

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
    isChatRenderMarkdownEnabled().then(setRenderMarkdownState);
    isChatShowToolTracesEnabled().then(setShowToolTracesState);
    isProviderNoticeDismissed(DEFAULT_CHAT_PROVIDER).then(setNoticeDismissed);
    refreshContext();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session") {
        if (changes[CHAT_WRITE_TOOLS_KEY]) {
          setWriteToolsEnabledState(changes[CHAT_WRITE_TOOLS_KEY].newValue === true);
        }
        if (changes[CHAT_RENDER_MARKDOWN_KEY]) {
          const next = changes[CHAT_RENDER_MARKDOWN_KEY].newValue;
          setRenderMarkdownState(next === undefined ? true : next === true);
        }
        if (changes[CHAT_SHOW_TOOL_TRACES_KEY]) {
          setShowToolTracesState(changes[CHAT_SHOW_TOOL_TRACES_KEY].newValue === true);
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

    if (autoUseContext && detectedContext) {
      return {
        entityId: detectedContext.entityId,
        entityType: detectedContext.entityType,
        source: "detected" as const,
      };
    }

    return null;
  }, [autoUseContext, detectedContext, manualEntityId, manualEntityType]);

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

  async function handleToggleToolTraces() {
    const next = !showToolTraces;

    try {
      await setChatShowToolTracesEnabled(next);
      setShowToolTracesState(next);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update tool trace visibility.");
    }
  }

  async function handleToggleRenderMarkdown() {
    const next = !renderMarkdown;

    try {
      await setChatRenderMarkdownEnabled(next);
      setRenderMarkdownState(next);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update markdown rendering.");
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
        systemPrompt: buildChatSystemPrompt({
          writeToolsEnabled,
          modelName: savedSettings.model,
        }),
        tools: getChatToolDeclarations({ writeToolsEnabled }),
        executeTool: (name, args) => executeChatTool(name, args, { writeToolsEnabled }),
      });

      setHistory(result.history);
      const consultedResources = summarizeToolResources(result.toolEvents);
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
          ...(consultedResources.length > 0 ? { consultedResources } : {}),
        },
      ]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Chat request failed.");
    } finally {
      setBusy(false);
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd+Enter (macOS) or Ctrl+Enter (others) sends the message.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy && input.trim()) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${
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
        <div className="space-y-2 text-xs">
          {/* Mode */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <span className="font-medium text-slate-600">Mode</span>
            <div className="flex items-center justify-between gap-3">
              <p className="text-slate-500">
                {writeToolsEnabled
                  ? "Write tools enabled. Every write goes through confirmation."
                  : "Safe mode. Read-only tools only."}
              </p>
              <button
                onClick={() => void handleToggleWriteTools()}
                disabled={modeBusy || busy}
                className={`shrink-0 rounded-md px-3 py-1.5 font-medium disabled:opacity-50 ${
                  writeToolsEnabled
                    ? "bg-white text-amber-700 hover:bg-amber-100"
                    : "bg-white text-emerald-700 hover:bg-emerald-100"
                }`}
              >
                {modeBusy
                  ? "..."
                  : writeToolsEnabled
                    ? "Disable"
                    : "Enable"}
              </button>
            </div>
          </div>

          {/* Context */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <span className="font-medium text-slate-600">Context</span>
            {detectedContext ? (
              <p className="text-slate-700">
                Detected: {detectedContext.entityType} {detectedContext.entityId}
                {detectedContext.entityName ? ` (${detectedContext.entityName})` : ""}
              </p>
            ) : (
              <p className="text-slate-500">No entity detected yet -- navigate to an entity in the dashboard.</p>
            )}
            <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={autoUseContext}
                onChange={(event) => setAutoUseContext(event.target.checked)}
                className="rounded border-slate-300"
              />
              Use detected entity automatically
            </label>
            <button
              onClick={() => setShowManualOverride((v) => !v)}
              className="text-slate-500 hover:text-slate-700 underline underline-offset-2"
            >
              {showManualOverride ? "Hide manual override" : "Manual override"}
            </button>
            {showManualOverride && (
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
                  placeholder="Entity ID"
                  className="flex-1 rounded-md border border-slate-200 px-2 py-1.5"
                />
              </div>
            )}
          </div>

          {/* Tool traces */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <span className="font-medium text-slate-600">Tool traces</span>
            <p className="text-slate-500">
              Show raw tool-call cards in the message list. This is mainly for debugging and may include expected dead ends or intermediate notes.
            </p>
            <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={showToolTraces}
                onChange={() => void handleToggleToolTraces()}
                className="rounded border-slate-300"
              />
              Show tool traces
            </label>
            {!showToolTraces && (
              <p className="text-slate-500">
                Off by default - intermediate tool traces stay hidden unless you need to inspect them.
              </p>
            )}
          </div>

          {/* Markdown */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <span className="font-medium text-slate-600">Markdown</span>
            <p className="text-slate-500">
              Render assistant answers using a safe Markdown subset for lists, emphasis, inline code, code blocks, and links.
            </p>
            <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={renderMarkdown}
                onChange={() => void handleToggleRenderMarkdown()}
                className="rounded border-slate-300"
              />
              Render Markdown
            </label>
            <p className="text-slate-500">
              On by default - assistant messages are rendered with a restricted Markdown allowlist and no raw HTML.
            </p>
          </div>

          {/* Model */}
          <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-slate-600">Model</span>
              <span className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-slate-700">Gemini</span>
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-600">API key</label>
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
                placeholder="Required to encrypt the API key"
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
                {settingsBusy ? "Saving..." : "Save"}
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
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {CURATED_CHIPS.map((chip) => (
          <button
            key={chip}
            onClick={() => setInput(chip)}
            className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            {chip}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 space-y-2 rounded-md border border-slate-200 bg-white p-3 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-xs text-slate-500">
            {writeToolsEnabled
              ? "Ask about the current entity, inspect configuration, or request a scoped change that can go through confirmation."
              : "Ask a read-only question about the current entity, its settings, hierarchy, contacts, or merchant accounts."}
          </p>
        ) : (
          messages.map((message) => {
            if (message.role === "tool") {
              return showToolTraces ? <ToolMessage key={message.id} message={message} /> : null;
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
                {message.role === "assistant" && message.consultedResources && message.consultedResources.length > 0 && (
                  <div className="mb-1 text-2xs text-slate-500">
                    {`Consulted: ${message.consultedResources.join(", ")}`}
                  </div>
                )}
                {message.role === "assistant" && renderMarkdown
                  ? <AssistantMarkdown text={message.text} />
                  : message.text}
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
          onKeyDown={handleInputKeyDown}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder={inputFocused ? "" : (writeToolsEnabled
            ? "Ask about the current entity or request a confirmed change... (Cmd+Enter to send)"
            : "Ask a read-only question about the current entity... (Cmd+Enter to send)")}
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

function ToolMessage({
  message,
}: {
  message: Extract<DisplayMessage, { role: "tool" }>;
}) {
  const result =
    typeof message.result === "object" && message.result !== null
      ? (message.result as Record<string, unknown>)
      : null;
  const isHardFailure =
    result !== null
    && (("ok" in result && result.ok === false)
      || ("status" in result && typeof result.status === "number" && result.status >= 400));
  const isGuidance = result !== null && "error" in result && !isHardFailure;
  const statusLabel = isHardFailure ? "error" : isGuidance ? "note" : "ok";
  const statusClass = isHardFailure
    ? "text-red-600"
    : isGuidance
      ? "text-amber-700"
      : "text-emerald-600";
  const statusSymbol = isHardFailure ? "\u2717" : isGuidance ? "\u25cf" : "\u2713";

  return (
    <details className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs">
      <summary className="cursor-pointer font-medium text-slate-700 flex items-center gap-1">
        <span className="font-mono text-blue-600">{message.toolName}</span>
        <span className={statusClass}>
          {`${statusSymbol} ${statusLabel}`}
        </span>
      </summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-2xs text-slate-600">
{JSON.stringify({ args: message.args, result: message.result }, null, 2)}
      </pre>
    </details>
  );
}