import { describe, expect, it } from "vitest";

import { detectSectionFromUrl, normalizeDetectedName } from "../../content/context-scraper";

describe("context scraper helpers", () => {
  it("detects section names from BIP URLs", () => {
    expect(detectSectionFromUrl("https://eu-test.oppwa.com/merchantAccounts?scope=attachedMerchantAccounts")).toBe("attachedMerchantAccounts");
    expect(detectSectionFromUrl("https://eu-test.oppwa.com/channels/abc123/setting")).toBe("settings");
  });

  it("normalizes plausible entity names and rejects generic values", () => {
    expect(normalizeDetectedName("  Test Channel 01  ")).toBe("Test Channel 01");
    expect(normalizeDetectedName("web api extension")).toBeUndefined();
    expect(normalizeDetectedName("8ac7a4c99d912998019d92e7aea8027c")).toBeUndefined();
  });
});