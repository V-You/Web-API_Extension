// Type declaration so tsc can resolve the out-of-include JSON import
declare module "../../base_data/chat_discovery_playbook.json" {
  const value: {
    schema_version: string;
    purpose: string;
    promptChips: string[];
    principles: string[];
    playbooks: Array<{ trigger: string; steps: string[] }>;
    responseStyle: string[];
    maintenance: string[];
  };
  export default value;
}
