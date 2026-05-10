import { describe, expect, it } from "vitest";

import { TOOL_SCHEMAS } from "./webmcp/tool-schemas";
import { futureWebMcpToolCount, TOOL_CATEGORIES, totalToolCount } from "../sidepanel/views/HomePage";

describe("HomePage tool inventory", () => {
  it("matches the published WebMCP tool surface", () => {
    const homeToolNames = TOOL_CATEGORIES.flatMap((category) => [
      ...category.handwritten.map((tool) => tool.name),
      ...category.generated.map((tool) => tool.name),
    ]).sort();
    const webMcpToolNames = TOOL_SCHEMAS.map((schema) => schema.name).sort();

    expect(homeToolNames).toEqual(webMcpToolNames);
    expect(totalToolCount).toBe(47);
    expect(futureWebMcpToolCount).toBe(13);
  });
});
