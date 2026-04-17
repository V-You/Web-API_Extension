import { describe, expect, it } from "vitest";

import { describeOperation, listManifestTools } from "./describe-operation";

describe("describe_operation", () => {
  it("returns the create_contact manifest entries grouped by parent level", () => {
    const res = describeOperation({ toolName: "create_contact" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.operations.length).toBeGreaterThanOrEqual(3); // psp, division, merchant
    for (const op of res.operations) {
      expect(op.method).toBe("POST");
      expect(op.pathTemplate).toMatch(/ownedContacts$/);
      const names = op.request.map((f) => f.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "email",
          "name",
          "role",
          "kind",
          "language",
          "oauthRedirectUrl",
          "sendCredentialsMail",
          "sendAuthenticatorMail",
        ]),
      );
    }
  });

  it("marks oauthRedirectUrl as conditional on kind=OAUTH_APP", () => {
    const res = describeOperation({ toolName: "create_contact" });
    if (!res.ok) throw new Error("expected ok");
    const op = res.operations[0];
    const field = op.request.find((f) => f.name === "oauthRedirectUrl");
    expect(field).toBeDefined();
    expect(field!.required).toBe("conditional");
    expect(field!.conditionalTrigger).toEqual({ field: "kind", value: "OAUTH_APP" });
  });

  it("classifies boolean-like fields via character-value-mapping", () => {
    const res = describeOperation({ toolName: "create_contact" });
    if (!res.ok) throw new Error("expected ok");
    const op = res.operations[0];
    const autoAttach = op.request.find((f) => f.name === "autoAttach");
    expect(autoAttach?.logicalType).toBe("boolean");
  });

  it("routes lock_contact to /contacts/{contactId}/lockContact", () => {
    const res = describeOperation({ toolName: "lock_contact" });
    if (!res.ok) throw new Error("expected ok");
    const op = res.operations[0];
    expect(op.method).toBe("POST");
    expect(op.pathTemplate).toBe("/contacts/{contactId}/lockContact");
    expect(op.destructive).toBe(false);
  });

  it("marks set_contact_password as destructive", () => {
    const res = describeOperation({ toolName: "set_contact_password" });
    if (!res.ok) throw new Error("expected ok");
    expect(res.operations[0].destructive).toBe(true);
    expect(res.operations[0].pathTemplate).toBe("/contacts/{contactId}/setPassword");
  });

  it("returns attach_merchant_account with spec fields", () => {
    const res = describeOperation({ toolName: "attach_merchant_account" });
    if (!res.ok) throw new Error("expected ok");
    const op = res.operations[0];
    expect(op.method).toBe("POST");
    const names = op.request.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["merchantAccountId"]));
  });

  it("create_division exposes name + state + customerId + description", () => {
    const res = describeOperation({ toolName: "create_division" });
    if (!res.ok) throw new Error("expected ok");
    const op = res.operations[0];
    const names = op.request.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["name", "state", "customerId", "description"]));
  });

  it("rejects unknown tool name and lists available tools", () => {
    const res = describeOperation({ toolName: "nope" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.availableTools).toContain("create_contact");
  });

  it("rejects empty tool name", () => {
    const res = describeOperation({ toolName: "" });
    expect(res.ok).toBe(false);
  });

  it("listManifestTools returns a stable sorted set", () => {
    const tools = listManifestTools();
    expect(tools).toEqual([...tools].sort());
    expect(tools).toContain("create_contact");
    expect(tools).toContain("create_division");
    expect(tools).toContain("attach_merchant_account");
  });
});
