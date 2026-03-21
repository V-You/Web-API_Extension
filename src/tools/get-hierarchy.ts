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
    children: [],
  };

  for (const div of divisions) {
    const divId = String(div.id ?? div.divisionId ?? "");
    const divNode: HierarchyNode = {
      id: divId,
      type: "division",
      name: String(div.name ?? ""),
      data: div,
      children: [],
    };

    if (depth >= 2 && divId) {
      const merchRes = await apiRequest<Record<string, unknown>[]>(creds, env, {
        path: `/divisions/${divId}/merchants`,
      });
      const merchants = merchRes.ok && Array.isArray(merchRes.data) ? merchRes.data : [];

      for (const merch of merchants) {
        const merchId = String(merch.id ?? merch.merchantId ?? "");
        const merchNode: HierarchyNode = {
          id: merchId,
          type: "merchant",
          name: String(merch.name ?? ""),
          data: merch,
          children: [],
        };

        if (depth >= 3 && merchId) {
          const chanRes = await apiRequest<Record<string, unknown>[]>(creds, env, {
            path: `/merchants/${merchId}/channels`,
          });
          const channels = chanRes.ok && Array.isArray(chanRes.data) ? chanRes.data : [];

          for (const ch of channels) {
            // Quirk: channel field is the entity ID, not id
            const chanId = String(ch.channel ?? ch.id ?? "");
            merchNode.children.push({
              id: chanId,
              type: "channel",
              name: String(ch.name ?? ""),
              data: ch,
              children: [],
            });
          }
        }

        divNode.children.push(merchNode);
      }
    }

    tree.children.push(divNode);
  }

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
