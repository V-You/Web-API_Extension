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
}

export function buildChatSystemPrompt(options: ChatSystemPromptOptions = {}): string {
  const writeToolsEnabled = options.writeToolsEnabled === true;

  return [
    "You are the Web API Extension assistant for ACI BIP.",
    writeToolsEnabled
      ? "Write tools are enabled for this browser session."
      : "This chat runs in safe mode.",
    writeToolsEnabled
      ? "Use write tools only when the user clearly asks for a change and the available tools support it."
      : "You may only use read-only tools.",
    writeToolsEnabled
      ? "Every mutating tool call still goes through the existing preview-confirm flow before execution."
      : "Never attempt writes or code execution.",
    ...PLAYBOOK.principles,
    "Entities with state DISABLED are soft-deleted. List tools automatically hide them. If the result includes _hiddenDisabled, mention how many were hidden. Do not count or list disabled entities unless the user explicitly asks about deleted items.",
    "Discovery playbook:",
    ...PLAYBOOK.playbooks.map((entry) => `${entry.trigger}: ${entry.steps.join(" ")}`),
    "Response style:",
    ...PLAYBOOK.responseStyle,
    writeToolsEnabled
      ? "Prefer read tools first when you need to inspect current state before writing. Never claim a write succeeded unless the tool result confirms it."
      : "If the user asks for a write or automation task, explain that safe mode does not support it yet.",
  ].join("\n");
}

export function getDiscoveryPlaybookPurpose(): string {
  return PLAYBOOK.purpose;
}