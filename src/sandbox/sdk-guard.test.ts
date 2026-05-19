import { describe, expect, it } from "vitest";
import { suggestClosest, wrapSdkWithGuard, SdkUnknownMemberError } from "./sdk-guard";

describe("suggestClosest", () => {
  it("returns the closest typo within threshold", () => {
    expect(suggestClosest("entites", ["entities", "hierarchy", "audit"])).toBe("entities");
    expect(suggestClosest("entity", ["entities", "hierarchy"])).toBe("entities");
  });

  it("returns case-insensitive exact match", () => {
    expect(suggestClosest("Entities", ["entities", "audit"])).toBe("entities");
  });

  it("returns undefined when nothing is close enough", () => {
    expect(suggestClosest("xyz", ["entities", "hierarchy"])).toBeUndefined();
  });
});

describe("wrapSdkWithGuard", () => {
  const buildSdk = () => ({
    config: { settingsTree: true }, // passthrough
    entities: {
      get: async () => "got",
      create: async () => "created",
    },
    hierarchy: {
      fetch: async () => "fetched",
    },
  });

  it("passes through valid namespace and method access", async () => {
    const sdk = wrapSdkWithGuard(buildSdk());
    expect(await sdk.entities.get()).toBe("got");
    expect(await sdk.hierarchy.fetch()).toBe("fetched");
  });

  it("does not wrap passthrough namespaces", () => {
    const sdk = wrapSdkWithGuard(buildSdk());
    // Reading a non-existent property on config must NOT throw -- config is
    // a Virtual SDK proxy and owns its own access semantics.
    expect((sdk.config as Record<string, unknown>).anything).toBeUndefined();
  });

  it("throws SdkUnknownMemberError for unknown namespaces", () => {
    const sdk = wrapSdkWithGuard(buildSdk());
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (sdk as any).entitties;
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SdkUnknownMemberError);
      const e = err as SdkUnknownMemberError;
      expect(e.member).toBe("entitties");
      expect(e.suggestion).toBe("entities");
      expect(e.namespace).toBeUndefined();
    }
  });

  it("throws SdkUnknownMemberError for unknown methods with suggestion", () => {
    const sdk = wrapSdkWithGuard(buildSdk());
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (sdk.entities as any).creat;
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(SdkUnknownMemberError);
      const e = err as SdkUnknownMemberError;
      expect(e.namespace).toBe("entities");
      expect(e.member).toBe("creat");
      expect(e.suggestion).toBe("create");
      expect(e.available).toContain("create");
      expect(e.available).toContain("get");
    }
  });

  it("does not interfere with await / thenable checks on namespaces", async () => {
    const sdk = wrapSdkWithGuard(buildSdk());
    // Resolving a value that includes the wrapped sdk shouldn't trip on .then
    const wrapped = await Promise.resolve(sdk.entities);
    expect(wrapped).toBeDefined();
  });

  it("returns the same wrapped namespace instance on repeated access", () => {
    const sdk = wrapSdkWithGuard(buildSdk());
    expect(sdk.entities).toBe(sdk.entities);
  });
});
