import playbookData from "../../base_data/chat_discovery_playbook.json";

interface DiscoveryPlaybookStep {
  trigger: string;
  steps: string[];
}

interface DiscoveryPlaybook {
  purpose: string;
  promptChips: string[];
  principles: string[];
  playbooks: DiscoveryPlaybookStep[];
  responseStyle: string[];
  maintenance: string[];
}

const PLAYBOOK = playbookData as DiscoveryPlaybook;

export const CHAT_DISCOVERY_PROMPT_CHIPS = PLAYBOOK.promptChips;

export interface ChatSystemPromptOptions {
  writeToolsEnabled?: boolean;
  automationModeEnabled?: boolean;
  draftJobTurn?: boolean;
  modelName?: string;
}

export interface ChatWorkflowDraftPromptOptions {
  userRequest: string;
  env: string;
  entityId?: string;
  entityType?: string;
  entityName?: string;
  section?: string;
}

export function buildChatSystemPrompt(options: ChatSystemPromptOptions = {}): string {
  const writeToolsEnabled = options.writeToolsEnabled === true;
  const automationModeEnabled = writeToolsEnabled && options.automationModeEnabled === true;
  const configuredModel = options.modelName?.trim() || "Gemini";

  return [
    "You are the Web API Extension assistant for ACI BIP.",
    `The underlying LLM currently configured for this chat is ${configuredModel}.`,
    "If the user asks about your model, model name, or version, answer with the configured Gemini model identifier directly.",
    "Do not describe safe mode or write mode as your model name or version - those are chat tool permissions, not model identity.",
    automationModeEnabled
      ? "Automation workflow tools are enabled for this browser session."
      : writeToolsEnabled
      ? "Write tools are enabled for this browser session."
      : "This chat runs in safe mode.",
    automationModeEnabled
      ? "Automation mode is enabled for this browser session. Use execute_workflow for repeated writes and backend batch work instead of calling write tools one by one. The separate Draft Job action may prepare longer TypeScript workflow scripts for review before a background Job starts."
      : "Automation mode is disabled. Do not draft or run workflow scripts from ordinary chat turns.",
    writeToolsEnabled
      ? "Use write tools only when the user clearly asks for a change and the available tools support it."
      : automationModeEnabled
      ? "Use execute_workflow only when the user clearly asks for automation or repeated backend work."
      : "You may only use read-only tools.",
    writeToolsEnabled || automationModeEnabled
      ? "Every mutating tool call still goes through the existing preview-confirm flow before execution."
      : "Never attempt writes or code execution.",
    ...PLAYBOOK.principles,
    "Entities with state DISABLED are soft-deleted. List and hierarchy tools automatically hide them unless includeDisabled=true. If the result includes _hiddenDisabled, mention how many were hidden. Do not count or list disabled entities unless the user explicitly asks about deleted items.",
    "For settings results with source: unknown, state the API limitation briefly and include the default value if present. Do not offer UI inspection from Chat Tab.",
    "Discovery playbook:",
    ...PLAYBOOK.playbooks.map((entry) => `${entry.trigger}: ${entry.steps.join(" ")}`),
    "Response style:",
    ...PLAYBOOK.responseStyle,
    options.draftJobTurn
      ? "This is a Draft Job turn. Return a workflow draft for review, not a normal assistant answer. Do not use direct write tools."
      : "Ordinary Send turns should use direct tools where appropriate and should not create Jobs.",
    writeToolsEnabled || automationModeEnabled
      ? "Prefer read tools first when you need to inspect current state before writing. Never claim a write succeeded unless the tool result confirms it."
      : "If the user asks for a write or automation task, explain that safe mode does not support it yet.",
  ].join("\n");
}

export function buildChatWorkflowDraftPrompt(options: ChatWorkflowDraftPromptOptions): string {
  const context = options.entityId && options.entityType
    ? [
        `Target context: ${options.entityType} ${options.entityId}.`,
        options.entityName ? `Entity name: ${options.entityName}.` : null,
        options.section ? `Current BIP section: ${options.section}.` : null,
      ].filter(Boolean).join("\n")
    : "No entity context is available. The script must ask for explicit identifiers by throwing a clear error if it cannot proceed.";

  return [
    "Draft a reviewed background Job for the Web API Extension.",
    `Environment snapshot: ${options.env}.`,
    context,
    `User request: ${options.userRequest}`,
    "Return only valid JSON with this exact shape:",
    "{\"label\":\"short job label\",\"totalCalls\":1,\"script\":\"TypeScript workflow source\"}",
    "The script runs in the existing workflow sandbox with sdk, console, sleep, results, context, signal, and progress available.",
    "Use context.entityId and context.entityType when the request targets the current dashboard entity.",
    "Call progress(completedCalls, totalCalls, checkpoint) as work advances. Push final report objects into results.",
    "Keep the workflow focused and add short comments before sections that perform writes.",
    "Do not wrap the JSON in Markdown or code fences.",
  ].join("\n");
}

export function getDiscoveryPlaybookPurpose(): string {
  return PLAYBOOK.purpose;
}