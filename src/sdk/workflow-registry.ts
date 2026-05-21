import workflowSdkRegistry from "../../src_data/workflow-sdk-registry.json";

export interface WorkflowSdkMethodSpec {
  name: string;
  args: string;
  overloaded?: boolean;
}

export interface WorkflowSdkNamespaceSpec {
  name: string;
  methods: WorkflowSdkMethodSpec[];
}

export interface WorkflowSdkRegistry {
  source: string;
  description: string;
  namespaces: WorkflowSdkNamespaceSpec[];
  topLevelMethods?: WorkflowSdkMethodSpec[];
}

export const WORKFLOW_SDK_REGISTRY = workflowSdkRegistry as WorkflowSdkRegistry;

export const WORKFLOW_SDK_METHODS = [
  ...WORKFLOW_SDK_REGISTRY.namespaces.flatMap((ns) => ns.methods.map((method) => `${ns.name}.${method.name}`)),
  ...(WORKFLOW_SDK_REGISTRY.topLevelMethods ?? []).map((method) => method.name),
].sort();

export const WORKFLOW_SDK_NAMESPACE_METHODS = new Map<string, string[]>(
  WORKFLOW_SDK_REGISTRY.namespaces.map((ns) => [ns.name, ns.methods.map((method) => method.name)]),
);

export const WORKFLOW_SDK_TOP_LEVEL_MEMBERS = new Set<string>([
  ...WORKFLOW_SDK_NAMESPACE_METHODS.keys(),
  ...(WORKFLOW_SDK_REGISTRY.topLevelMethods ?? []).map((method) => method.name),
]);
