/**
 * get_hierarchy tool handler.
 *
 * Fetches the full entity tree starting from a PSP, with configurable depth.
 * Before executing, estimates the number of API calls and expected runtime.
 *
 * Depth levels:
 *   1 = divisions only
 *   2 = divisions + merchants
 *   3 = divisions + merchants + channels (full tree)
 */

import { apiRequest } from "../lib/api-client";
import { ENTITY_PLURAL } from "../lib/entity-types";
import type { ApiCredentials, Environment } from "../lib/types";

export interface GetHierarchyInput {
  /** The PSP entity ID (root of the tree). */
  pspId: string;
  /** How deep to traverse (1-3, default 3). */
  depth?: number;
  /** If true, only return the call estimate -- do not execute. */
  estimateOnly?: boolean;
}

interface HierarchyNode {
  id: string;
  type: string;
  name?: string;
  data: Record<string, unknown>;
  children: HierarchyNode[];
}

/** Fetch child entities and map each to a HierarchyNode. */
async function fetchChildren(
  parentPath: string,
  childType: string,
  idField: string,
  creds: ApiCredentials,
  env: Environment
): Promise<{ raw: Record<string, unknown>[]; nodes: HierarchyNode[] }> {
  const res = await apiRequest<Record<string, unknown>[]>(creds, env, { path: parentPath });
  const items = res.ok && Array.isArray(res.data) ? res.data : [];
  const nodes = items.map((item) => ({
    id: String(item[idField] ?? item.id ?? ""),
    type: childType,
    name: String(item.name ?? ""),
    data: item,
    children: [] as HierarchyNode[],
  }));
  return { raw: items, nodes };
}

/** Build a division node with its merchant (and optionally channel) children. */
async function buildDivisionNode(
  div: Record<string, unknown>,
  depth: number,
  creds: ApiCredentials,
  env: Environment
): Promise<HierarchyNode> {
  const divId = String(div.id ?? div.divisionId ?? "");
  const node: HierarchyNode = {
    id: divId,
    type: "division",
    name: String(div.name ?? ""),
    data: div,
    children: [],
  };

  if (depth >= 2 && divId) {
    const { nodes: merchants } = await fetchChildren(
      `/divisions/${divId}/merchants`, "merchant", "merchantId", creds, env
    );
    for (const m of merchants) {
      if (depth >= 3 && m.id) {
        const { nodes: channels } = await fetchChildren(
          `/merchants/${m.id}/channels`, "channel", "channel", creds, env
        );
        m.children = channels;
      }
    }
    node.children = merchants;
  }

  return node;
}

export async function executeGetHierarchy(
  input: GetHierarchyInput,
  creds: ApiCredentials,
  env: Environment
) {
  const depth = Math.min(Math.max(input.depth ?? 3, 1), 3);

  // Step 1: fetch divisions to get an estimate
  const divRes = await apiRequest<Record<string, unknown>[]>(creds, env, {
    path: `/${ENTITY_PLURAL.psp}/${input.pspId}/${ENTITY_PLURAL.division}`,
  });

  if (!divRes.ok) {
    return { error: "Failed to list divisions.", status: divRes.status, data: divRes.data };
  }

  const divisions = Array.isArray(divRes.data) ? divRes.data : [];

  // Estimate API calls
  // 1 (list divs) + divs * 1 (get each) + divs * 1 (list merchants per div if depth>=2)
  // For depth 3, add merchants * 1 (list channels per merchant)
  // We don't know merchant/channel counts yet, so use the legacy heuristic (avg 3 merchants/div, 2 channels/merchant)
  const divCount = divisions.length;
  let estimatedCalls = 1; // Already made: list divisions
  if (depth >= 1) estimatedCalls += divCount; // Get each division
  const estMerchants = divCount * 3;
  if (depth >= 2) estimatedCalls += divCount + estMerchants; // List + get merchants
  const estChannels = estMerchants * 2;
  if (depth >= 3) estimatedCalls += estMerchants + estChannels; // List + get channels

  const estimatedSeconds = Math.ceil(estimatedCalls / 9);
  const estimate = {
    divisions: divCount,
    estimatedMerchants: depth >= 2 ? estMerchants : 0,
    estimatedChannels: depth >= 3 ? estChannels : 0,
    estimatedApiCalls: estimatedCalls,
    estimatedRuntime: `~${estimatedSeconds}s (${Math.ceil(estimatedSeconds / 60)}min at 9 req/s)`,
  };

  if (input.estimateOnly) {
    return { estimate };
  }

  // Step 2: traverse the tree
  const tree: HierarchyNode = {
    id: input.pspId,
    type: "psp",
    data: {},
    children: await Promise.all(divisions.map((div) => buildDivisionNode(div, depth, creds, env))),
  };

  // Actual counts
  const actualMerchants = tree.children.reduce((n, d) => n + d.children.length, 0);
  const actualChannels = tree.children.reduce(
    (n, d) => n + d.children.reduce((m, me) => m + me.children.length, 0),
    0
  );

  return {
    estimate,
    actual: {
      divisions: tree.children.length,
      merchants: actualMerchants,
      channels: actualChannels,
    },
    tree,
  };
}
