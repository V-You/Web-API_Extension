/**
 * Type declarations for the WebMCP imperative API (navigator.modelContext).
 *
 * Available in Chrome 146+ with the #enable-webmcp-testing flag.
 * See: https://developer.chrome.com/docs/extensions/ai/
 */

interface WebMcpToolDefinition {
  /** Tool name -- must be unique per registration context. */
  name: string;
  /** Plain-language description for the agent. */
  description: string;
  /** JSON Schema object describing the tool's input parameters. */
  inputSchema: Record<string, unknown>;
  /** Called by the agent to execute the tool. Returns a result string or object. */
  execute: (params: Record<string, unknown>) => unknown | Promise<unknown>;
}

interface ModelContext {
  /** Register a tool with the WebMCP runtime. */
  registerTool(definition: WebMcpToolDefinition): void;
}

declare global {
  interface Navigator {
    /** WebMCP model context -- present in Chrome 146+ with WebMCP flag enabled. */
    modelContext?: ModelContext;
  }
}

export {};
