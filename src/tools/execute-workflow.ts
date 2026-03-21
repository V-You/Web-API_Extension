/**
 * execute_workflow tool handler (stub).
 *
 * Executes a TypeScript script in a local sandbox with the virtual SDK
 * available as `sdk`. This is the code-mode entry point -- the agent writes
 * a script, and this tool runs it locally.
 *
 * Full implementation requires:
 *   - Virtual SDK proxy (build step 3) -- DONE, see src/sdk/
 *   - Code-mode sandbox with isolated execution (build step 4)
 *   - Preview/confirm bridge for write operations (build step 5)
 *
 * This stub validates the input shape and returns a not-yet-implemented marker
 * so the agent knows the tool exists but cannot execute scripts yet.
 */

export interface ExecuteWorkflowInput {
  /** TypeScript source code to execute. */
  script: string;
  /** Entity context for the script (optional). */
  entityId?: string;
  entityType?: string;
  /** If true, dry-run only -- parse and validate but do not execute. */
  dryRun?: boolean;
}

export async function executeWorkflow(input: ExecuteWorkflowInput) {
  if (!input.script) {
    return { error: "script is required." };
  }

  // Stub: script execution is not yet implemented (requires build steps 3-5)
  return {
    status: "not_implemented",
    message: "execute_workflow requires the code-mode sandbox (build step 4), which is not yet built. The virtual SDK (step 3) is ready. The script was received but not executed.",
    scriptLength: input.script.length,
    dryRun: input.dryRun ?? false,
  };
}
