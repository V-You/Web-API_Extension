/**
 * Type declarations for the WebMCP imperative API (navigator.modelContext).
 *
 * Matches the official type definitions from GoogleChromeLabs/webmcp-tools.
 * Available in Chrome 146+ with the #enable-webmcp-testing flag.
 * See: https://developer.chrome.com/blog/webmcp-epp
 */

interface ModelContextClient {
  requestUserInteraction(callback: () => void): void;
}

interface ModelContextTool {
  /** Tool name -- must be unique per registration context. */
  name: string;
  /** Plain-language description for the agent. */
  description: string;
  /** JSON Schema object describing the tool's input parameters. */
  inputSchema?: object;
  /** JSON Schema object describing the tool's output shape. */
  outputSchema?: object;
  /** Optional hints for the agent about the tool's behavior. */
  annotations?: {
    readOnlyHint?: boolean;
  };
  /** Called by the agent to execute the tool. */
  execute: (
    input: Record<string, unknown>,
    client: ModelContextClient,
  ) => unknown | Promise<unknown>;
}

interface ModelContext {
  /** Register a tool with the WebMCP runtime. */
  registerTool(tool: ModelContextTool): void;
  /** Unregister a previously registered tool by name. */
  unregisterTool(name: string): void;
}

/** Testing API -- only available with #enable-webmcp-testing flag. */
interface ModelContextTesting {
  listTools(): ModelContextTool[];
  executeTool(name: string, inputArgs: Record<string, unknown>): Promise<unknown>;
  addEventListener(type: "toolchange", callback: () => void): void;
}

declare global {
  interface Navigator {
    /** WebMCP model context -- present in Chrome 146+ with WebMCP flag enabled. */
    modelContext?: ModelContext;
    /** WebMCP testing API -- present with #enable-webmcp-testing flag. */
    modelContextTesting?: ModelContextTesting;
  }

  /** Injected at build time by DefinePlugin. */
  const __BUILD_TIMESTAMP__: string;
}

export {};
