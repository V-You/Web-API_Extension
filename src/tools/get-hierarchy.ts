/**
 * get_hierarchy tool handler.
 *
 * Fetches the full entity tree starting from any hierarchy node, with
 * configurable depth.
 * Before executing, estimates the number of API calls and expected runtime.
 *
 * Depth levels are relative to the selected root:
 *   1 = direct children only
 *   2 = children + grandchildren
 *   3 = full tree below the root
 */

import { apiRequest } from "../lib/api-client";
import { ENTITY_PLURAL, entityPath, type EntityType } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";

export interface GetHierarchyInput {
  /** Legacy PSP root ID. */
  pspId?: string;
  /** Root entity ID when starting below PSP level. */
  entityId?: string;
  /** Root entity type when starting below PSP level. */
  entityType?: EntityType;
  /** How deep to traverse (1-3, default 3). */
  depth?: number;
  /** If true, only return the call estimate -- do not execute. */
  estimateOnly?: boolean;
}

interface HierarchyNode {
  id: string;
  type: EntityType;
  name?: string;
  data: Record<string, unknown>;
  children: HierarchyNode[];
}

interface HierarchyRoot {
  id: string;
  type: EntityType;
  node: HierarchyNode;
}

const CHILD_TYPE_BY_PARENT: Partial<Record<EntityType, EntityType>> = {
  psp: "division",
  division: "merchant",
  merchant: "channel",
};

function getRootSelection(input: GetHierarchyInput): { id: string; type: EntityType } | null {
  if (input.entityId && input.entityType) {
    return { id: input.entityId, type: input.entityType };
  }

  if (input.pspId) {
    return { id: input.pspId, type: "psp" };
  }

  return null;
}

function entityIdFromRecord(type: EntityType, item: Record<string, unknown>): string {
  switch (type) {
    case "psp":
      return String(item.id ?? item.pspId ?? "");
    case "division":
      return String(item.id ?? item.divisionId ?? "");
    case "merchant":
      return String(item.id ?? item.merchantId ?? "");
    case "channel":
      return String(item._entityId ?? item.channel ?? item.id ?? "");
  }
}

function toNode(type: EntityType, item: Record<string, unknown>, fallbackId: string): HierarchyNode {
  return {
    id: entityIdFromRecord(type, item) || fallbackId,
    type,
    name: String(item.name ?? item.description ?? ""),
    data: item,
    children: [],
  };
}

/** Fetch child entities and map each to a HierarchyNode. */
async function fetchChildren(
  parentType: EntityType,
  parentId: string,
  childType: EntityType,
  creds: ApiCredentials,
  env: Environment
): Promise<{ ok: boolean; status: number; data: unknown; nodes: HierarchyNode[] }> {
  const path = `/${ENTITY_PLURAL[parentType]}/${parentId}/${ENTITY_PLURAL[childType]}`;
  const res = await apiRequest<Record<string, unknown>[]>(creds, env, { path });
  const items = res.ok && Array.isArray(res.data) ? res.data : [];
  const nodes = items.map((item) => toNode(childType, item, ""));
  return {
    ok: res.ok,
    status: res.status,
    data: res.data,
    nodes,
  };
}

async function buildHierarchyChildren(
  node: HierarchyNode,
  remainingDepth: number,
  creds: ApiCredentials,
  env: Environment
): Promise<void> {
  if (remainingDepth <= 0) return;

  const childType = CHILD_TYPE_BY_PARENT[node.type];
  if (!childType || !node.id) return;

  const childRes = await fetchChildren(node.type, node.id, childType, creds, env);
  node.children = childRes.nodes;

  if (remainingDepth <= 1) return;

  for (const child of node.children) {
    await buildHierarchyChildren(child, remainingDepth - 1, creds, env);
  }
}

async function resolveRootNode(
  input: GetHierarchyInput,
  creds: ApiCredentials,
  env: Environment,
): Promise<HierarchyRoot | { error: string; status?: number; data?: unknown }> {
  const root = getRootSelection(input);
  if (!root) {
    return { error: "Provide either pspId or entityId + entityType." };
  }

  if (root.type === "psp") {
    return {
      id: root.id,
      type: root.type,
      node: {
        id: root.id,
        type: root.type,
        data: {},
        children: [],
      },
    };
  }

  const res = await apiRequest<Record<string, unknown>>(creds, env, {
    path: entityPath(root.type, root.id),
  });

  if (!res.ok || !res.data || Array.isArray(res.data)) {
    return {
      error: `Failed to fetch ${root.type} ${root.id}.`,
      status: res.status,
      data: res.data,
    };
  }

  return {
    id: root.id,
    type: root.type,
    node: toNode(root.type, res.data as Record<string, unknown>, root.id),
  };
}

function estimateHierarchy(rootType: EntityType, depth: number) {
  if (rootType === "psp") {
    const estDivisions = 3;
    const estMerchants = depth >= 2 ? estDivisions * 3 : 0;
    const estChannels = depth >= 3 ? estMerchants * 2 : 0;
    const estimatedApiCalls = 1 + (depth >= 2 ? estDivisions : 0) + (depth >= 3 ? estMerchants : 0);

    return {
      estimatedApiCalls,
      estimatedRuntime: `~${Math.ceil(estimatedApiCalls / 9)}s (${Math.ceil(Math.ceil(estimatedApiCalls / 9) / 60)}min at 9 req/s)`,
      estimatedDivisions: estDivisions,
      estimatedMerchants: estMerchants,
      estimatedChannels: estChannels,
    };
  }

  if (rootType === "division") {
    const estMerchants = depth >= 1 ? 3 : 0;
    const estChannels = depth >= 2 ? estMerchants * 2 : 0;
    const estimatedApiCalls = 1 + (depth >= 1 ? 1 : 0) + (depth >= 2 ? estMerchants : 0);

    return {
      estimatedApiCalls,
      estimatedRuntime: `~${Math.ceil(estimatedApiCalls / 9)}s (${Math.ceil(Math.ceil(estimatedApiCalls / 9) / 60)}min at 9 req/s)`,
      estimatedDivisions: 0,
      estimatedMerchants: estMerchants,
      estimatedChannels: estChannels,
    };
  }

  if (rootType === "merchant") {
    const estChannels = depth >= 1 ? 2 : 0;
    const estimatedApiCalls = 1 + (depth >= 1 ? 1 : 0);

    return {
      estimatedApiCalls,
      estimatedRuntime: `~${Math.ceil(estimatedApiCalls / 9)}s (${Math.ceil(Math.ceil(estimatedApiCalls / 9) / 60)}min at 9 req/s)`,
      estimatedDivisions: 0,
      estimatedMerchants: 0,
      estimatedChannels: estChannels,
    };
  }

  const estimatedApiCalls = 1;
  return {
    estimatedApiCalls,
    estimatedRuntime: `~${Math.ceil(estimatedApiCalls / 9)}s (${Math.ceil(Math.ceil(estimatedApiCalls / 9) / 60)}min at 9 req/s)`,
    estimatedDivisions: 0,
    estimatedMerchants: 0,
    estimatedChannels: 0,
  };
}

function countNodesByType(node: HierarchyNode): { divisions: number; merchants: number; channels: number } {
  const counts = { divisions: 0, merchants: 0, channels: 0 };

  for (const child of node.children) {
    if (child.type === "division") counts.divisions += 1;
    if (child.type === "merchant") counts.merchants += 1;
    if (child.type === "channel") counts.channels += 1;

    const nested = countNodesByType(child);
    counts.divisions += nested.divisions;
    counts.merchants += nested.merchants;
    counts.channels += nested.channels;
  }

  return counts;
}

export async function executeGetHierarchy(
  input: GetHierarchyInput,
  creds: ApiCredentials,
  env: Environment
) {
  const depth = Math.min(Math.max(input.depth ?? 3, 1), 3);
  const rootSelection = getRootSelection(input);
  if (!rootSelection) {
    return { error: "Provide either pspId or entityId + entityType." };
  }

  const root = await resolveRootNode(input, creds, env);
  if ("error" in root) {
    return root;
  }

  const estimateBase = estimateHierarchy(root.type, depth);
  const estimate = {
    rootType: root.type,
    rootId: root.id,
    estimatedDivisions: estimateBase.estimatedDivisions,
    estimatedMerchants: estimateBase.estimatedMerchants,
    estimatedChannels: estimateBase.estimatedChannels,
    estimatedApiCalls: estimateBase.estimatedApiCalls,
    estimatedRuntime: estimateBase.estimatedRuntime,
  };

  if (input.estimateOnly) {
    return { estimate };
  }

  await buildHierarchyChildren(root.node, depth, creds, env);
  const actual = countNodesByType(root.node);

  return {
    estimate,
    actual,
    tree: root.node,
  };
}
