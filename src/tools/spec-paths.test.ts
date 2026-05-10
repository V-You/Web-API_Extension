/**
 * Phase 0 guardrail: assert every handler action invokes an HTTP
 * method + path that exists in the bundled OpenAPI spec.
 *
 * The test reads base_data/ACI_Web-API_OpenAPI.yaml as plain text
 * (no YAML dependency): it extracts the set of `{path}` keys and their
 * HTTP methods with a simple regex. Handler paths are normalized to the
 * same `{p}` placeholder shape before comparison.
 *
 * When the YAML is absent, the whole
 * suite skips with a clear reason.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "../lib/api-client";
import { executeManageContact } from "./manage-contact";
import { executeManageEntity } from "./manage-entity";
import { executeManageMerchantAccount } from "./manage-merchant-account";

const SPEC_PATH = resolve(__dirname, "../../base_data/ACI_Web-API_OpenAPI.yaml");
const apiRequestMock = vi.mocked(apiRequest);

interface SpecRoute {
  path: string;
  methods: Set<string>;
}

function loadSpecRoutes(): Map<string, SpecRoute> {
  const text = readFileSync(SPEC_PATH, "utf8");
  const lines = text.split("\n");
  const result = new Map<string, SpecRoute>();
  let current: SpecRoute | null = null;

  const pathRe = /^ {2}(\/\S+?):\s*$/;
  const methodRe = /^ {4}(get|post|put|delete|patch):\s*$/;

  for (const line of lines) {
    const pm = pathRe.exec(line);
    if (pm) {
      const normalized = normalize(pm[1]);
      current = result.get(normalized) ?? { path: normalized, methods: new Set() };
      result.set(normalized, current);
      continue;
    }
    if (current) {
      const mm = methodRe.exec(line);
      if (mm) current.methods.add(mm[1].toUpperCase());
    }
  }
  return result;
}

/** Replace `{name}` segments with `{p}` so spec and handler paths align. */
function normalize(path: string): string {
  return path.replace(/\{[^}]+\}/g, "{p}");
}

/**
 * Normalize a concrete handler path like `/contacts/abc/lockContact` to
 * `/contacts/{p}/lockContact` so it can be looked up in the spec map.
 *
 * Any segment that was originally substituted with a variable (marked
 * here by captured IDs) is converted to `{p}`. We keep known literal
 * sub-resource names (alphabetic, mixed-case) as-is.
 */
function normalizeHandlerPath(path: string, dynamicIds: string[]): string {
  let out = path;
  for (const id of dynamicIds) {
    if (!id) continue;
    out = out.split(id).join("{p}");
  }
  return out;
}

const SPEC_EXISTS = existsSync(SPEC_PATH);
const describeIf = SPEC_EXISTS ? describe : describe.skip;

describeIf("handler HTTP method+path coverage vs bundled OpenAPI spec", () => {
  let routes: Map<string, SpecRoute>;

  beforeAll(() => {
    routes = loadSpecRoutes();
  });

  function expectRoute(method: string, handlerPath: string, dynamicIds: string[]) {
    const normalized = normalizeHandlerPath(handlerPath, dynamicIds);
    const route = routes.get(normalized);
    if (!route) {
      throw new Error(
        `Handler path ${method} ${handlerPath} (normalized: ${normalized}) not found in spec.`,
      );
    }
    expect(route.methods, `spec methods for ${normalized}`).toContain(method);
  }

  function captureLastRequest(): { method: string; path: string } {
    const call = apiRequestMock.mock.calls.at(-1);
    if (!call) throw new Error("apiRequest was not called");
    const opts = call[2] as { method?: string; path: string };
    return { method: (opts.method ?? "GET").toUpperCase(), path: opts.path };
  }

  const CONTACT_ID = "c0ffee";
  const ENTITY_ID = "feedf00d";
  const MA_ID = "deadbeef";
  const IDS = [CONTACT_ID, ENTITY_ID, MA_ID];

  const CREDS = {} as never;
  const ENV = "uat" as never;

  beforeAll(() => {
    apiRequestMock.mockResolvedValue({ ok: true, status: 200, data: {} });
  });

  // -- manage_contact --

  it.each([
    { action: "get" as const, extras: { contactId: CONTACT_ID } },
    { action: "delete" as const, extras: { contactId: CONTACT_ID } },
    { action: "lock" as const, extras: { contactId: CONTACT_ID } },
    { action: "unlock" as const, extras: { contactId: CONTACT_ID } },
    {
      action: "reset_password" as const,
      extras: { contactId: CONTACT_ID, newPassword: "x" },
    },
    {
      action: "edit" as const,
      extras: { contactId: CONTACT_ID, fields: { name: "x" } },
    },
  ])("manage_contact $action targets a spec route", async ({ action, extras }) => {
    await executeManageContact({ action, ...extras } as never, CREDS, ENV);
    const req = captureLastRequest();
    expectRoute(req.method, req.path, IDS);
  });

  it.each(["psp", "division", "merchant", "channel"] as const)(
    "manage_contact list owned (%s) targets a spec route",
    async (entityType) => {
      await executeManageContact(
        { action: "list", entityId: ENTITY_ID, entityType, scope: "owned" },
        CREDS,
        ENV,
      );
      expectRoute(...Object.values(captureLastRequest()) as [string, string], IDS);
    },
  );

  it.each(["psp", "division", "merchant", "channel"] as const)(
    "manage_contact list attached (%s) targets a spec route",
    async (entityType) => {
      await executeManageContact(
        { action: "list", entityId: ENTITY_ID, entityType, scope: "attached" },
        CREDS,
        ENV,
      );
      const req = captureLastRequest();
      expectRoute(req.method, req.path, IDS);
    },
  );

  it.each(["psp", "division", "merchant"] as const)(
    "manage_contact create (%s) targets a spec route",
    async (entityType) => {
      await executeManageContact(
        {
          action: "create",
          entityId: ENTITY_ID,
          entityType,
          fields: { email: "x@x", name: "x", role: "OPERATOR", kind: "SEND", language: "en" },
        },
        CREDS,
        ENV,
      );
      const req = captureLastRequest();
      expectRoute(req.method, req.path, IDS);
    },
  );

  it.each(["psp", "division", "merchant", "channel"] as const)(
    "manage_contact detach (%s) targets a spec route",
    async (entityType) => {
      await executeManageContact(
        { action: "detach", entityId: ENTITY_ID, entityType, contactId: CONTACT_ID },
        CREDS,
        ENV,
      );
      const req = captureLastRequest();
      expectRoute(req.method, req.path, IDS);
    },
  );

  // -- manage_entity --

  it.each(["division", "merchant", "channel"] as const)(
    "manage_entity get (%s) targets a spec route",
    async (entityType) => {
      await executeManageEntity(
        { action: "get", entityId: ENTITY_ID, entityType },
        CREDS,
        ENV,
      );
      const req = captureLastRequest();
      expectRoute(req.method, req.path, IDS);
    },
  );

  it.each([
    { parentType: "psp" as const, childType: "division" as const },
    { parentType: "division" as const, childType: "merchant" as const },
    { parentType: "merchant" as const, childType: "channel" as const },
  ])("manage_entity create $childType under $parentType targets a spec route", async ({ parentType, childType }) => {
    await executeManageEntity(
      { action: "create", parentId: ENTITY_ID, parentType, childType, fields: { name: "x" } },
      CREDS,
      ENV,
    );
    const req = captureLastRequest();
    expectRoute(req.method, req.path, IDS);
  });

  it("manage_entity edit targets a spec route", async () => {
    await executeManageEntity(
      { action: "edit", entityId: ENTITY_ID, entityType: "division", fields: { name: "x" } },
      CREDS,
      ENV,
    );
    const req = captureLastRequest();
    expectRoute(req.method, req.path, IDS);
  });

  it("manage_entity delete targets a spec route", async () => {
    await executeManageEntity(
      { action: "delete", entityId: ENTITY_ID, entityType: "division" },
      CREDS,
      ENV,
    );
    const req = captureLastRequest();
    expectRoute(req.method, req.path, IDS);
  });

  // -- manage_merchant_account --

  it.each([
    { action: "get" as const, extras: { merchantAccountId: MA_ID } },
    { action: "delete" as const, extras: { merchantAccountId: MA_ID } },
    { action: "three_d_check" as const, extras: { merchantAccountId: MA_ID } },
    {
      action: "edit" as const,
      extras: { merchantAccountId: MA_ID, fields: { name: "x" } },
    },
  ])("manage_merchant_account $action targets a spec route", async ({ action, extras }) => {
    await executeManageMerchantAccount({ action, ...extras } as never, CREDS, ENV);
    const req = captureLastRequest();
    expectRoute(req.method, req.path, IDS);
  });

  it.each(["psp", "division", "merchant", "channel"] as const)(
    "manage_merchant_account list owned (%s) targets a spec route",
    async (entityType) => {
      await executeManageMerchantAccount(
        { action: "list", entityId: ENTITY_ID, entityType, scope: "owned" },
        CREDS,
        ENV,
      );
      const req = captureLastRequest();
      expectRoute(req.method, req.path, IDS);
    },
  );

  it.each(["psp", "division", "merchant", "channel"] as const)(
    "manage_merchant_account list attached (%s) targets a spec route",
    async (entityType) => {
      await executeManageMerchantAccount(
        { action: "list", entityId: ENTITY_ID, entityType, scope: "attached" },
        CREDS,
        ENV,
      );
      const req = captureLastRequest();
      expectRoute(req.method, req.path, IDS);
    },
  );

  it.each(["psp", "division", "merchant", "channel"] as const)(
    "manage_merchant_account create (%s) targets a spec route",
    async (entityType) => {
      await executeManageMerchantAccount(
        {
          action: "create",
          entityId: ENTITY_ID,
          entityType,
          fields: { name: "x", merchantId: "m" },
        },
        CREDS,
        ENV,
      );
      const req = captureLastRequest();
      expectRoute(req.method, req.path, IDS);
    },
  );

  it.each(["psp", "division", "merchant", "channel"] as const)(
    "manage_merchant_account attach (%s) targets a spec route",
    async (entityType) => {
      await executeManageMerchantAccount(
        {
          action: "attach",
          entityId: ENTITY_ID,
          entityType,
          merchantAccountId: MA_ID,
          subTypes: "VISA",
          currency: "EUR",
        },
        CREDS,
        ENV,
      );
      const req = captureLastRequest();
      expectRoute(req.method, req.path, IDS);
    },
  );

  it("manage_merchant_account detach targets a spec route", async () => {
    await executeManageMerchantAccount(
      { action: "detach", attachedMerchantAccountId: MA_ID },
      CREDS,
      ENV,
    );
    const req = captureLastRequest();
    expectRoute(req.method, req.path, IDS);
  });
});
