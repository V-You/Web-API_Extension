/**
 * Content-script WebMCP registration.
 *
 * Registers tools on oppwa pages so browser side-panel assistants
 * (for example Gemini) can discover tools even when the extension's
 * own side panel UI is not open.
 */

import { registerAllTools } from "../src/webmcp/register-tools";

registerAllTools();
