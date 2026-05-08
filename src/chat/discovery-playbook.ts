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
  accessTokenControlEnabled?: boolean;
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
  const accessTokenControlEnabled = writeToolsEnabled && options.accessTokenControlEnabled === true;
  const automationModeEnabled = writeToolsEnabled && options.automationModeEnabled === true;
  const configuredModel = options.modelName?.trim() || "Gemini";

  return [
    "You are the Web API Extension assistant for ACI BIP.",
    `The underlying LLM currently configured for this chat is ${configuredModel}.`,
    "If the user asks about your model, model name, or version, answer with the configured Gemini model identifier directly.",
    "Do not describe safe mode or write mode as your model name or version - those are chat tool permissions, not model identity.",
    automationModeEnabled
      ? "Automation workflow tools are enabled for this browser session."
      : accessTokenControlEnabled
      ? "accessToken control is enabled for this browser session."
      : writeToolsEnabled
      ? "Write tools are enabled for this browser session."
      : "This chat runs in safe mode.",
    accessTokenControlEnabled
      ? "API token lifecycle tools are available. Never reveal raw bearer tokens; use redacted metadata and extension-owned transaction tools only."
      : "accessToken control is disabled. Do not create, update, suspend, activate, delete, or use transaction bearer tokens from ordinary chat turns.",
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
    "The dashboard binds context, but the Web API is authoritative. When the user asks to query, get, show, inspect, verify, compare, retrieve details, or show a raw result for the current entity, use a read API tool before answering instead of quoting visible dashboard text.",
    "For credential-like or API-detail fields such as channel accessToken, secret, pwd, login, sender, state, type, or channel id, do not answer from UI context alone when an entity read is available. Query the entity and label the answer as API-derived when useful.",
    "If a requested API field is missing from a raw response, say it is absent from that specific endpoint response and list the keys that were present. Do not claim the API never exposes the field unless an API spec or tool result proves that global claim.",
    "Transaction bearer tokens are Merchant-level-and-below secrets, not Channel-level tokens. Raw bearer tokens must never appear in LLM context, tool traces, audit logs, console logs, or normal UI text. If accessToken control is enabled, use API-token tools or Connections-owned transaction actions and rely on redacted metadata. If token tools are unavailable or disabled, instruct the user to go to Merchant level in BIP, then Administration > Account Data > Generate Api Bearer token, copy the new token, and save it in Connections under the Merchant entity UUID. Merchant Info shows existing tokens masked and cannot be recovered.",
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
    "The response must parse with JSON.parse. Escape script newlines as \\n and quotes as \\\" inside the script string. Do not use raw multiline strings, backticks, comments outside JSON, or Markdown fences.",
    "The script runs in the existing workflow sandbox with sdk, console, sleep, results, context, signal, and progress available.",
    "Use context.entityId and context.entityType when the request targets the current dashboard entity.",
    "Use sdk.entities.get(entityType, entityId) for entity details. Do not use sdk.management or sdk.manage_entity namespaces.",
    "The BIP glossary maps users to contacts. For user or contact work, use sdk.contacts methods.",
    "Create contacts with sdk.contacts.create(entityType, entityId, fields). For a current merchant, call sdk.contacts.create(context.entityType, context.entityId, { email, name, role, kind, language, ... }).",
    "List contacts created on an entity with sdk.contacts.list(entityType, entityId, \"owned\"). List contacts attached to an entity with sdk.contacts.list(entityType, entityId, \"attached\"). These calls return arrays; use the returned arrays directly with map/filter and do not read an .items property.",
    "Attach an existing contact with sdk.contacts.attach(entityType, entityId, contactId).",
    "For attach-all-available-contact workflows on the current entity, list available contacts with sdk.contacts.list(context.entityType, context.entityId, \"owned\"), list already attached contacts with sdk.contacts.list(context.entityType, context.entityId, \"attached\"), then attach missing IDs. Do not climb to the parent entity unless the user explicitly asks for parent-level contacts.",
    "For attach-all-available-contact workflows, totalCalls must include the two list calls plus one call per contact you expect to attach. If the exact count is unknown, estimate conservatively above 1 and call progress() after each phase.",
    "Use contact creation fields from the API shape: email, name, role, kind, language, mobile, autoAttach, description, oauthRedirectUrl, sendCredentialsMail, and sendAuthenticatorMail.",
    "Common contact defaults for generated examples are role: \"OPERATOR\", kind: \"SEND\", and language: \"en\" unless the user asks otherwise.",
    "Call progress(completedCalls, totalCalls, checkpoint) as work advances. Push final report objects into results.",
    "Keep the workflow focused and add short comments before sections that perform writes.",
    "Do not wrap the JSON in Markdown or code fences.",
  ].join("\n");
}

export function getDiscoveryPlaybookPurpose(): string {
  return PLAYBOOK.purpose;
}