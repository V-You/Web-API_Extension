import playbookData from "../../base_data/chat_discovery_playbook.json";
import { renderConfigTestRecipePrompt, type MatchedConfigTestRecipe } from "./config-test-recipes";
// PRD 2026-05-18 D15: generated authoritative SDK surface. Regenerated via
// `npm run generate:sdk-reference` from src/sandbox/sdk-facade.ts so the
// prompt enumerates every facade method, not a hand-maintained subset.
import { WORKFLOW_SDK_REFERENCE } from "../../src_data/workflow-sdk-reference";

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
  knownIds?: Record<string, string>;
  configTestRecipes?: MatchedConfigTestRecipe[];
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
    automationModeEnabled
      ? "Workflow scripts receive context.entityId, context.entityType, and when available context.ids with known dashboard IDs such as channelId and merchantId. Use context.ids before deriving IDs or asking the user."
      : null,
    automationModeEnabled
      ? "If a user request combines creation, configuration, token handling, repeated calls, or transaction testing, prefer one execute_workflow Job over a long chain of individual tool calls."
      : null,
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
    "For test transactions, code 800.900.300 or invalid authentication information is a recoverable token-authentication failure when accessToken control is enabled. Do not stop after reporting that error. Retry with send_test_transaction tokenMode=temporary if the user asks for a temporary token or if a stored token failed and a Merchant parent can be derived.",
    "When send_test_transaction needs merchantId for a Channel, derive it before asking the user: call get_entity or manage_entity get for the Channel and inspect _parent, merchantId, sender, parentId, or nearby hierarchy context. Only ask for merchantId after that read-based recovery fails.",
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
  const knownIds = options.knownIds && Object.keys(options.knownIds).length > 0
    ? `Known context IDs available in the script as context.ids: ${Object.entries(options.knownIds).map(([key, value]) => `${key}=${value}`).join(", ")}.`
    : null;
  const context = options.entityId && options.entityType
    ? [
        `Target context: ${options.entityType} ${options.entityId}.`,
        options.entityName ? `Entity name: ${options.entityName}.` : null,
        options.section ? `Current BIP section: ${options.section}.` : null,
        knownIds,
      ].filter(Boolean).join("\n")
    : "No entity context is available. The script must ask for explicit identifiers by throwing a clear error if it cannot proceed.";
  const configTestRecipePrompt = renderConfigTestRecipePrompt(options.configTestRecipes ?? []);

  return [
    "Draft a reviewed background Job for the Web API Extension.",
    `Environment snapshot: ${options.env}.`,
    context,
    `User request: ${options.userRequest}`,
    configTestRecipePrompt,
    WORKFLOW_SDK_REFERENCE,
    "Return only valid JSON with this exact shape:",
    "{\"label\":\"short job label\",\"totalCalls\":1,\"script\":\"TypeScript workflow source\"}",
    "The response must parse with JSON.parse. Escape script newlines as \\n and quotes as \\\" inside the script string. Do not use raw multiline strings, backticks, comments outside JSON, or Markdown fences.",
      "The script runs in the existing workflow sandbox with sdk, console, sleep(ms), results array, context, signal, and progress available.",
    "Write executable top-level workflow code directly. Do not wrap the workflow in async function runWorkflow() or any other function unless you also call it; uncalled wrapper functions do no work.",
    "Use context.entityId and context.entityType when the request targets the current dashboard entity.",
    "Use context.ids.channelId and context.ids.merchantId when present; do not re-derive or throw for a Merchant parent that is already present there.",
    "Use sdk.entities.get(entityType, entityId) for entity details. Do not use sdk.management or sdk.manage_entity namespaces.",
    "Use sdk.entities.listChildren(parentType, parentId, childType) to list child divisions, merchants, or channels. It returns an array; use map/filter/slice directly on the returned value. For channel rows, use row.id; the SDK aliases the API's channel field to id when needed.",
    "For settings, use sdk.settings.edit(entityType, entityId, settings) or sdk.config.update(entityType, entityId, settings). Use sdk.settings.batchEdit for multiple settings when that reads more naturally.",
    "For duplicate check / dupe check / doublet check, use the authoritative RiRo keys \"*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:active\" and \"*/type:entity/module:ctpe/processing:risk/risk:doublication/doublication:timeframe\". Use native typed values, for example active: true and timeframe: 10, not string values \"true\" or \"10\". Do not invent ib.dupeCheck or similar paths.",
    "For merchant accounts, use sdk.merchantAccounts.create(parentType, parentId, fields). When the user says on this Channel or for this Channel, prefer sdk.merchantAccounts.create(\"channel\", context.entityId, fields). Use a Merchant parent only when the user explicitly asks for Merchant-level availability or the API requires Merchant scope.",
    "For merchant account create fields, include name, state, merchantId, and either clearingInstituteId or clearingInstituteName in the same create call. merchantId is the MID value. clearingInstituteId must be a 32-character API UUID; if you only have a CI code or label such as ACCEPTANCE, use clearingInstituteName instead. Do not create first and add state later.",
    "Do not use mid, identification, paymentBrand, paymentBrands, brands, or config fields on merchant account create; they are not create_merchant_account API fields.",
    "For subtype or currency processing such as VISA/EUR, do not edit the Merchant Account with subTypes. Save the Merchant Account returned by create, derive const merchantAccountId = ma.id || ma.merchantAccountId, throw if it is missing, then attach it to the target entity: sdk.merchantAccounts.attach(context.entityType, context.entityId, merchantAccountId, \"VISA\", \"EUR\"). For multiple currencies, attach once per currency.",
    "Use sdk.merchantAccounts.edit(merchantAccountId, fields) or sdk.merchantAccounts.update(merchantAccountId, fields) for merchant account changes.",
    "For merchant account activation, use state: \"LIVE\" rather than status: \"ACTIVE\".",
    "For random card processor or acquirer selection, use sdk.cardProcessors.list(context.ids?.pspId). In background Jobs, the SDK derives the PSP ID from current context when possible so this returns the live PSP-scoped clearing-institute list.",
    "sdk.cardProcessors.list returns an array of { id, ciCode, name, requiredFields }. Use clearingInstituteId: processor.id only when id is a 32-character API UUID. Otherwise use clearingInstituteName: processor.name or processor.ciCode. Do not pass processor data through a generic clearingInstitute field.",
    "When the user names a Clearing Institute, first call sdk.cardProcessors.list(context.ids?.pspId) and fuzzy-match against name and ciCode case-insensitively. Use the matched processor's exact API UUID as clearingInstituteId when present, otherwise use its exact API name as clearingInstituteName. Do not invent display names such as Elavon when the available name is ELAVON_CI.",
    "Workflow context exposes both context.entityId/context.entityType and aliases context.id/context.type for the current entity.",
    "The BIP glossary maps users to contacts. For user or contact work, use sdk.contacts methods.",
    "Create contacts with sdk.contacts.create(entityType, entityId, fields). For a current merchant, call sdk.contacts.create(context.entityType, context.entityId, { email, name, role, kind, language, ... }).",
    "List contacts created on an entity with sdk.contacts.list(entityType, entityId, \"owned\"). List contacts attached to an entity with sdk.contacts.list(entityType, entityId, \"attached\"). These calls return arrays; use the returned arrays directly with map/filter and do not read an .items property.",
    "Attach an existing contact with sdk.contacts.attach(entityType, entityId, contactId).",
    "For attach-all-available-contact workflows on the current entity, list available contacts with sdk.contacts.list(context.entityType, context.entityId, \"owned\"), list already attached contacts with sdk.contacts.list(context.entityType, context.entityId, \"attached\"), then attach missing IDs. Do not climb to the parent entity unless the user explicitly asks for parent-level contacts.",
    "For attach-all-available-contact workflows, totalCalls must include the two list calls plus one call per contact you expect to attach. If the exact count is unknown, estimate conservatively above 1 and call progress() after each phase.",
    "Use contact creation fields from the API shape: email, name, role, kind, language, mobile, autoAttach, description, oauthRedirectUrl, sendCredentialsMail, and sendAuthenticatorMail.",
    "Common contact defaults for generated examples are role: \"OPERATOR\", kind: \"SEND\", and language: \"en\" unless the user asks otherwise.",
    "For multiple test transactions in one workflow, call sdk.transactions.sendTestBatch({ channelId, merchantId, count, tokenMode: \"temporary\", ... }) so one temporary token covers the whole batch. merchantId is optional when the current context is a Channel - the Job runtime will derive it from context or a Channel GET before creating a temporary token.",
    "For sdk.transactions.sendTest and sendTestBatch, transaction parameters must be a flat object. Use top-level cardNumber, cardHolder, cardExpiryMonth, cardExpiryYear, and cardCvv. Do not use a nested card object such as card: { holder: \"Dupe Test\" }; card is not an accepted field.",
    "If transaction testing recipe context is present above, follow it before choosing random transaction values. Keep recipe constants stable, vary only recipe variables, and report verified, failed, or inconclusive in a final testingIntent result object.",
    "For a single test transaction, call sdk.transactions.sendTest({ channelId, merchantId, tokenMode: \"temporary\", ... }). Do not throw your own error for a missing parent Merchant before calling the transaction helper. Let the SDK helper perform deterministic recovery.",
    "sendTest returns status-compatible fields at transaction.status, transaction.statusCode, transaction.response.status, and transaction.result.status. Prefer transaction.status for summaries and guard optional nested fields. sendTestBatch returns a transactions array with the same per-transaction fields.",
    "Call progress(completedCalls, totalCalls, checkpoint) as work advances. Push final report objects into results.",
    "Keep the workflow focused and add short comments before sections that perform writes.",
    "Do not wrap the JSON in Markdown or code fences.",
      "Do not use import, export, require, fetch, window, document, chrome, setTimeout, or setInterval in workflow scripts. All available capabilities are already injected.",
  ].join("\n");
}

export function getDiscoveryPlaybookPurpose(): string {
  return PLAYBOOK.purpose;
}