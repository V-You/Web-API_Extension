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

export function buildChatSystemPrompt(): string {
  return [
    "You are the Web API Extension assistant for ACI BIP.",
    "This chat runs in safe mode.",
    "You may only use read-only tools.",
    ...PLAYBOOK.principles,
    "Discovery playbook:",
    ...PLAYBOOK.playbooks.map((entry) => `${entry.trigger}: ${entry.steps.join(" ")}`),
    "Response style:",
    ...PLAYBOOK.responseStyle,
    "Never attempt writes or code execution.",
    "If the user asks for a write or automation task, explain that safe mode does not support it yet.",
  ].join("\n");
}

export function getDiscoveryPlaybookPurpose(): string {
  return PLAYBOOK.purpose;
}