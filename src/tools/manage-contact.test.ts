import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "../lib/api-client";
import {
  addCreateContactHint,
  executeManageContact,
  normalizeCreateContactFields,
} from "./manage-contact";

const apiRequestMock = vi.mocked(apiRequest);

describe("manage_contact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through spec-shaped contact create fields without inventing aliases", async () => {
    apiRequestMock.mockResolvedValue({ ok: true, status: 200, data: { id: "contact-1" } });

    await executeManageContact(
      {
        action: "create",
        entityId: "merchant-1",
        entityType: "merchant",
        fields: {
          email: "random.user@example.com",
          name: "Random User",
          role: "CALLCENTER_RESTRICTED",
          kind: "SEND",
          language: "en",
        },
      },
      {} as never,
      "uat" as never,
    );

    expect(apiRequestMock).toHaveBeenCalledWith(
      expect.anything(),
      "uat",
      expect.objectContaining({
        method: "POST",
        path: "/merchants/merchant-1/ownedContacts",
        params: {
          email: "random.user@example.com",
          name: "Random User",
          role: "CALLCENTER_RESTRICTED",
          kind: "SEND",
          language: "en",
        },
      }),
      expect.anything(),
    );
  });

  it("adds a spec-aligned hint to the generic missing-values response", () => {
    const result = addCreateContactHint(
      {
        ok: true,
        status: 200,
        data: {
          error: {
            message: "Check the required values. At least one is missing.",
          },
        },
      },
      {
        email: "random.user@example.com",
        firstName: "Random",
        lastName: "User",
      },
    );

    expect((result.data as { error: { hint?: string } }).error.hint).toContain("bundled OpenAPI contact schema");
    expect((result.data as { error: { hint?: string } }).error.hint).toContain("email, name, role, kind, language");
    expect((result.data as { error: { hint?: string } }).error.hint).toContain("firstName, lastName");
  });

  it("does not invent non-spec contact create aliases", () => {
    expect(normalizeCreateContactFields({ email: "random.user@example.com" })).toEqual({
      email: "random.user@example.com",
    });

    expect(normalizeCreateContactFields({
      email: "random.user@example.com",
      name: "Random User",
    })).toEqual({
      email: "random.user@example.com",
      name: "Random User",
    });
  });
});