/**
 * SDK facade for the sandbox.
 *
 * Wraps all tool handlers as SDK-style async methods so the agent's script
 * can call sdk.entities.get(...) instead of executeManageEntity({action:"get",...}).
 *
 * Also exposes the VirtualSdk.config for typed settings operations.
 *
 * Write operations go through:
 *   1. The outer preview/confirm bridge (confirmAndWrite below).
 *   2. The typed adapter (executeTypedTool) with `confirm: true` to bypass
 *      the adapter's own confirm layer, since confirmation already happened.
 *
 * The adapter enforces D5 (path params), D6 (unknown-field rejection),
 * and D7 (form-encode coercion). Runtime code-mode writes are therefore
 * held to the same correctness bar as WebMCP per-action writes (Part-II
 * P2-D3). `VirtualSdk` stays settings-only; the sandbox facade is the
 * typed domain surface for code-mode (Part-II P2-D3a).
 */

import {
  normalizeListResult as sharedNormalizeListResult,
} from "../lib/list-contract";
import { createWorkflowSdk } from "../sdk/workflow-sdk";
import type { WorkflowWritePreview } from "../sdk/workflow-entity-namespace";
import type { ApiCredentials, Environment } from "../lib/types";
import { requestConfirm, type WritePreview } from "../bridge/confirm-bridge";
import { recordWrite } from "../bridge/write-status";
import { wrapSdkWithGuard } from "./sdk-guard";
import type {
  Params_attach_merchant_account,
  Params_create_channel,
  Params_create_contact,
  Params_create_division,
  Params_create_merchant,
  Params_create_merchant_account,
  Params_delete_contact,
  Params_delete_entity,
  Params_delete_merchant_account,
  Params_detach_contact,
  Params_detach_merchant_account,
  Params_edit_contact,
  Params_edit_entity,
  Params_edit_merchant_account,
  Params_lock_contact,
  Params_set_contact_password,
  Params_unlock_contact,
} from "../../src_data/webapi-sdk";

// Re-export the generated typed parameter shapes for code-mode script
// authors and anyone wiring against the sandbox facade (Part-II P2-D3a --
// ensures `webapi-sdk.d.ts` has a real runtime consumer).
export type {
  Params_attach_merchant_account,
  Params_create_channel,
  Params_create_contact,
  Params_create_division,
  Params_create_merchant,
  Params_create_merchant_account,
  Params_delete_contact,
  Params_delete_entity,
  Params_delete_merchant_account,
  Params_detach_contact,
  Params_detach_merchant_account,
  Params_edit_contact,
  Params_edit_entity,
  Params_edit_merchant_account,
  Params_lock_contact,
  Params_set_contact_password,
  Params_unlock_contact,
};

export interface WriteRecord {
  tool: string;
  action: string;
  entityId: string;
  entityType: string;
  params: Record<string, unknown>;
  timestamp: string;
}

export interface SdkFacadeOptions {
  autoConfirmWrites?: boolean;
  planOnlyWrites?: boolean;
}

/**
 * Universal SDK list contract.
 *
 * Re-export of `normalizeListResult` from src/lib/list-contract.ts so the
 * sandbox facade and the SW job executor share one implementation. Every
 * `sdk.*.list*` / `sdk.*.search` SDK method must route through this helper
 * (see md/2026-05-18_PRD_contract-first-workflow-sdk.md).
 */
export const normalizeListResult = sharedNormalizeListResult;

/**
 * Build the full `sdk` object injected into sandbox scripts.
 *
 * Every write operation goes through confirmAndWrite() which:
 *   1. Sends a preview to the confirmation bridge
 *   2. Waits for user approval (confirm / cancel / confirm_all)
 *   3. Records the write in the writes[] array
 *   4. Throws if the user cancels
 */
export function buildSdkFacade(
  creds: ApiCredentials,
  env: Environment,
  writes: WriteRecord[],
  options: SdkFacadeOptions = {},
) {
  /** Request confirmation, record write, or throw on cancel. */
  async function confirmAndWrite(
    tool: string,
    action: string,
    method: "POST" | "DELETE",
    entityId: string,
    entityType: string,
    description: string,
    params: Record<string, unknown>,
  ) {
    if (options.planOnlyWrites) {
      writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
      return;
    }

    if (options.autoConfirmWrites) {
      writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
      recordWrite(description);
      return;
    }

    const preview: WritePreview = { tool, action, method, description, params, env };
    const choice = await requestConfirm(preview);
    if (choice === "cancel") throw new Error("Operation cancelled by user.");
    writes.push({ tool, action, entityId, entityType, params, timestamp: new Date().toISOString() });
    recordWrite(description);
  }

  const beforeWrite = (preview: WorkflowWritePreview) => confirmAndWrite(
    preview.tool,
    preview.action,
    preview.method,
    preview.entityId,
    preview.entityType,
    preview.description,
    preview.params,
  );

  const facade = createWorkflowSdk({
    creds,
    env,
    host: {
      entityWriteTransport: "typedTool",
      contactWriteTransport: "typedTool",
      merchantAccountWriteTransport: "typedTool",
      planOnlyWrites: options.planOnlyWrites,
      validateMerchantAccountEditFields: false,
      beforeSettingsWrite: beforeWrite,
      beforeEntityWrite: beforeWrite,
      beforeContactWrite: beforeWrite,
      beforeMerchantAccountWrite: beforeWrite,
      bypassTransactionConfirmation: options.autoConfirmWrites === true,
      recordTransactionWrite: (transaction) => writes.push({ ...transaction, timestamp: new Date().toISOString() }),
    },
  });

  // PRD 2026-05-18 D14: reject unknown SDK members at runtime with a
  // structured suggestion instead of letting them silently become
  // `undefined`. `config` is the Virtual Settings SDK proxy and owns its
  // own access semantics, so we pass it through untouched.
  return wrapSdkWithGuard(facade, { passthroughNamespaces: ["config"] });
}

/** Type of the sdk object injected into sandbox scripts. */
export type SdkFacade = ReturnType<typeof buildSdkFacade>;
