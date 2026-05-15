import { describe, expect, it } from "vitest";

import { executeDescribeSettings } from "./describe-settings";

describe("describe_settings", () => {
  it("resolves plausibility-check family language to pb shortcodes", () => {
    const result = executeDescribeSettings({ query: "list all plausibility checks for this entity", limit: 20 });
    expect("error" in result).toBe(false);
    if ("error" in result) {
      throw new Error(result.error);
    }

    expect(result.familyResolution.applied).toBe(true);
    expect(result.familyResolution.matchedFamilies.map((family) => family.shortcode)).toEqual(
      expect.arrayContaining(["pb.ad", "pb.ba", "pb.bn", "pb.st", "pb.ho"]),
    );
    expect(result.familyGroups.map((group) => group.shortcode)).toEqual(
      expect.arrayContaining(["pb.ad", "pb.ba", "pb.bn", "pb.st", "pb.ho"]),
    );
  });

  it("still resolves direct plausibility shortcode queries", () => {
    const result = executeDescribeSettings({ query: "pb.ad", limit: 10 });
    expect("error" in result).toBe(false);
    if ("error" in result) {
      throw new Error(result.error);
    }

    expect(result.familyResolution.applied).toBe(true);
    expect(result.familyResolution.matchedFamilies.map((family) => family.shortcode)).toContain("pb.ad");
    expect(result.familyGroups[0]?.shortcode).toBe("pb.ad");
  });

  it.each(["dupe", "dedup", "dedupe", "duplicate"])("resolves %s to the duplicate-check family", (query) => {
    const result = executeDescribeSettings({ query, limit: 10 });
    expect("error" in result).toBe(false);
    if ("error" in result) {
      throw new Error(result.error);
    }

    expect(result.familyResolution.applied).toBe(true);
    expect(result.familyResolution.matchedFamilies.map((family) => family.shortcode)).toContain("db.db");
    expect(result.familyGroups[0]?.shortcode).toBe("db.db");
    expect(result.results[0]?.bipPath).toContain("Identifies Doublet within Timeframe");
    expect(result.results[0]?.key).not.toContain("CHARGEBACK_DUPLICATE");
  });
});