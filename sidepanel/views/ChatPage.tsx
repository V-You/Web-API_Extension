import { useCallback, useEffect, useMemo, useState } from "react";
import type { EntityType } from "../../src/lib/entity-types";
import type { Environment } from "../../src/lib/types";
import {
  CHAT_AUTOMATION_MODE_KEY,
  CHAT_RENDER_MARKDOWN_KEY,
  CHAT_SHOW_TOOL_TRACES_KEY,
  CHAT_WRITE_TOOLS_KEY,
  isChatAutomationModeEnabled,
  isChatRenderMarkdownEnabled,
  isChatShowToolTracesEnabled,
  isChatWriteToolsEnabled,
  setChatAutomationModeEnabled,
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
import { buildChatSystemPrompt, buildChatWorkflowDraftPrompt } from "../../src/chat/discovery-playbook";
import { getActiveChatContext, type ChatContextRecord } from "../../src/chat/context-store";
import { summarizeToolResources } from "../../src/chat/tool-provenance";
import { executeChatTool, getChatToolDeclarations } from "../../src/chat/tool-bridge";
import { parseWorkflowDraft } from "../../src/chat/workflow-draft";
import { startJob } from "../../src/jobs/job-runner";
import { getActiveEnv, getCredentials, getThrottleRate } from "../../src/lib/storage";
import { runGeminiTurn, type GeminiContent } from "../../src/chat/adapters/gemini";
import { copyTextToClipboard } from "../utils/clipboard";

type DisplayMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; consultedResources?: string[] }
  | { id: string; role: "tool"; toolName: string; args: Record<string, unknown>; result: unknown };

const CURATED_CHIPS = [
  "What entity is this?",
  "What is the dupe check set to?",
  "List all users",
];

const AUTOMATION_CHIPS = [
  "Draft a hierarchy settings audit for this entity",
  "Draft a job to list all contacts under this scope",
];

interface WorkflowReviewState {
  label: string;
  script: string;
  totalCalls: number;
  env: Environment;
  prompt: string;
  entityId?: string;
  entityType?: EntityType;
  entityName?: string;
  section?: string;
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
  const [automationModeEnabled, setAutomationModeEnabledState] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [automationBusy, setAutomationBusy] = useState(false);
  const [renderMarkdown, setRenderMarkdownState] = useState(true);
  const [showToolTraces, setShowToolTracesState] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [autoUseContext, setAutoUseContext] = useState(true);
  const [showManualOverride, setShowManualOverride] = useState(false);
  const [workflowReview, setWorkflowReview] = useState<WorkflowReviewState | null>(null);
  const [workflowReviewError, setWorkflowReviewError] = useState<string | null>(null);

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
    isChatAutomationModeEnabled().then(setAutomationModeEnabledState);
    isChatRenderMarkdownEnabled().then(setRenderMarkdownState);
    isChatShowToolTracesEnabled().then(setShowToolTracesState);
    isProviderNoticeDismissed(DEFAULT_CHAT_PROVIDER).then(setNoticeDismissed);
    refreshContext();

    const handleStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session") {
        if (changes[CHAT_WRITE_TOOLS_KEY]) {
          setWriteToolsEnabledState(changes[CHAT_WRITE_TOOLS_KEY].newValue === true);
        }
        if (changes[CHAT_AUTOMATION_MODE_KEY]) {
          setAutomationModeEnabledState(changes[CHAT_AUTOMATION_MODE_KEY].newValue === true);
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
      if (!next) setAutomationModeEnabledState(false);
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

  async function handleToggleAutomationMode() {
    const next = !automationModeEnabled;

    setModeBusy(true);
    setError(null);
    try {
      await setChatAutomationModeEnabled(next);
      setAutomationModeEnabledState(next);
      setHistory([]);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: next
            ? "Automation mode is enabled. Use Draft Job for reviewed workflow scripts that start real background Jobs."
            : "Automation mode is disabled. Ordinary chat and direct confirmed writes are still available according to the current mode.",
        },
      ]);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Failed to update automation mode.");
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
          automationModeEnabled,
          modelName: savedSettings.model,
        }),
        tools: getChatToolDeclarations({ writeToolsEnabled, automationModeEnabled }),
        executeTool: (name, args) => executeChatTool(name, args, { writeToolsEnabled, automationModeEnabled }),
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

  async function handleDraftJob() {
    const trimmed = input.trim();
    if (!trimmed || busy || automationBusy) return;
    if (!automationModeEnabled) {
      setError("Enable automation mode before drafting a Job.");
      return;
    }
    if (!savedSettings?.apiKey) {
      setError("Save Gemini settings first.");
      setSettingsOpen(true);
      return;
    }
    if (!noticeDismissed) {
      setError("Review and dismiss the Gemini privacy notice before drafting a Job.");
      return;
    }

    setBusy(true);
    setAutomationBusy(true);
    setError(null);
    setWorkflowReviewError(null);

    const userMessage: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmed,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");

    try {
      const env = await getActiveEnv();
      if (!env) throw new Error("No active environment. Unlock or select a connection before drafting a Job.");

      const draftPrompt = buildChatWorkflowDraftPrompt({
        userRequest: trimmed,
        env,
        entityId: effectiveContext?.entityId,
        entityType: effectiveContext?.entityType,
        entityName: detectedContext?.entityName,
        section: detectedContext?.section,
      });

      const result = await runGeminiTurn({
        apiKey: savedSettings.apiKey,
        model: savedSettings.model,
        history: [],
        userText: draftPrompt,
        systemPrompt: buildChatSystemPrompt({
          writeToolsEnabled: true,
          automationModeEnabled: true,
          draftJobTurn: true,
          modelName: savedSettings.model,
        }),
        tools: [],
        executeTool: async () => {
          throw new Error("Tools are not available while drafting a reviewed Job.");
        },
      });

      const draft = parseWorkflowDraft(result.assistantText);
      setWorkflowReview({
        label: draft.label,
        script: draft.script,
        totalCalls: draft.totalCalls,
        env,
        prompt: trimmed,
        entityId: effectiveContext?.entityId,
        entityType: effectiveContext?.entityType,
        entityName: detectedContext?.entityName,
        section: detectedContext?.section,
      });
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "I drafted a workflow for review. Check the script before starting the background Job.",
        },
      ]);
    } catch (draftError) {
      setError(draftError instanceof Error ? draftError.message : "Failed to draft workflow Job.");
    } finally {
      setBusy(false);
      setAutomationBusy(false);
    }
  }

  async function handleStartReviewedJob() {
    if (!workflowReview || automationBusy) return;

    setAutomationBusy(true);
    setWorkflowReviewError(null);
    try {
      const activeEnv = await getActiveEnv();
      if (!activeEnv) throw new Error("No active environment. Unlock or select a connection, then re-approve.");
      if (activeEnv !== workflowReview.env) {
        throw new Error(`Environment changed since draft (${workflowReview.env.toUpperCase()}). Switch back or draft again.`);
      }

      const creds = await getCredentials(workflowReview.env);
      if (!creds) throw new Error("Session locked. Unlock credentials and re-approve the workflow.");

      const throttleRate = await getThrottleRate();
      const job = await startJob({
        label: workflowReview.label,
        script: workflowReview.script,
        entityId: workflowReview.entityId,
        entityType: workflowReview.entityType,
        totalCalls: workflowReview.totalCalls,
        throttleRate,
        creds,
        env: workflowReview.env,
        source: "chat",
      });

      setWorkflowReview(null);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Started Job ${job.label} (${job.id}) in state: ${job.state}. Open the Jobs tab to monitor progress, pause, resume, or inspect failures.`,
        },
      ]);
    } catch (startError) {
      setWorkflowReviewError(startError instanceof Error ? startError.message : "Failed to start reviewed Job.");
    } finally {
      setAutomationBusy(false);
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
          automationModeEnabled
            ? "bg-red-50 text-red-700"
            : writeToolsEnabled
            ? "bg-amber-50 text-amber-700"
            : "bg-emerald-50 text-emerald-700"
        }`}>
          {automationModeEnabled ? "Automation mode" : writeToolsEnabled ? "Write tools enabled" : "Safe mode"}
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
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
              <p className="text-slate-500">
                {automationModeEnabled
                  ? "Automation mode enabled. Draft Job creates reviewed scripts that start background Jobs."
                  : "Automation mode is a higher-trust path for reviewed workflow scripts and background Jobs."}
              </p>
              <button
                onClick={() => void handleToggleAutomationMode()}
                disabled={modeBusy || busy || !writeToolsEnabled}
                className="shrink-0 rounded-md bg-white px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {modeBusy
                  ? "..."
                  : automationModeEnabled
                    ? "Disable"
                    : "Enable"}
              </button>
            </div>
            {!writeToolsEnabled && (
              <p className="text-slate-500">Enable write tools first. Automation scripts may combine many reads and writes after review.</p>
            )}
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
        {[...CURATED_CHIPS, ...(automationModeEnabled ? AUTOMATION_CHIPS : [])].map((chip) => (
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
              ? automationModeEnabled
                ? "Ask about the current entity, request a confirmed change, or use Draft Job for reviewed workflow automation."
                : "Ask about the current entity, inspect configuration, or request a scoped change that can go through confirmation."
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
                className={`rounded-md px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "ml-8 whitespace-pre-wrap bg-blue-50 text-blue-900"
                    : renderMarkdown
                      ? "mr-8 bg-slate-50 text-slate-800"
                      : "mr-8 whitespace-pre-wrap bg-slate-50 text-slate-800"
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

      {workflowReview && (
        <WorkflowReviewDialog
          draft={workflowReview}
          error={workflowReviewError}
          busy={automationBusy}
          onStart={() => void handleStartReviewedJob()}
          onCancel={() => {
            setWorkflowReview(null);
            setWorkflowReviewError(null);
          }}
        />
      )}

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleInputKeyDown}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          placeholder={inputFocused ? "" : (writeToolsEnabled
            ? automationModeEnabled
              ? "Ask normally, or use Draft Job for workflow automation... (Cmd+Enter to send)"
              : "Ask about the current entity or request a confirmed change... (Cmd+Enter to send)"
            : "Ask a read-only question about the current entity... (Cmd+Enter to send)")}
          rows={3}
          className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => void handleSend()}
          disabled={busy || automationBusy || !input.trim()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Sending..." : "Send"}
        </button>
        {automationModeEnabled && (
          <button
            onClick={() => void handleDraftJob()}
            disabled={busy || automationBusy || !input.trim()}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {automationBusy ? "Drafting..." : "Draft Job"}
          </button>
        )}
      </div>
    </div>
  );
}

function WorkflowReviewDialog({
  draft,
  error,
  busy,
  onStart,
  onCancel,
}: {
  draft: WorkflowReviewState;
  error: string | null;
  busy: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyTextToClipboard(draft.script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Review workflow Job</h2>
              <p className="mt-1 text-xs text-slate-500">Approve the TypeScript source as a whole before it starts in the Jobs tab.</p>
            </div>
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-2xs font-medium text-red-700">
              {draft.env.toUpperCase()}
            </span>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <div className="font-medium text-slate-600">Label</div>
              <div className="mt-1 text-slate-800">{draft.label}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
              <div className="font-medium text-slate-600">Estimated calls</div>
              <div className="mt-1 text-slate-800">{draft.totalCalls}</div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 sm:col-span-2">
              <div className="font-medium text-slate-600">Snapshot context</div>
              <div className="mt-1 text-slate-800">
                {draft.entityType && draft.entityId
                  ? `${draft.entityType} ${draft.entityId}${draft.entityName ? ` (${draft.entityName})` : ""}`
                  : "No entity context captured"}
                {draft.section ? ` - ${draft.section}` : ""}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 font-medium text-slate-600">Original request</div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-slate-700">{draft.prompt}</div>
          </div>

          <div>
            <div className="mb-1 font-medium text-slate-600">Script</div>
            <pre className="max-h-96 overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-2xs text-slate-100">
              {draft.script}
            </pre>
          </div>

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
          <button
            onClick={() => void handleCopy()}
            disabled={busy}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onStart}
            disabled={busy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Starting..." : "Start Job"}
          </button>
        </div>
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