import { describe, expect, it } from "vitest";

import { normalizeCardProcessors } from "./card-processors";

describe("card processor helpers", () => {
  it("normalizes bundled clearing-institute matches into array candidates", () => {
    const processors = normalizeCardProcessors({
      matches: [
        { ciCode: "VISA_ACQ", requiredFields: ["merchantId", "key"] },
      ],
    });

    expect(processors).toEqual([
      {
        id: "VISA_ACQ",
        ciCode: "VISA_ACQ",
        name: "VISA_ACQ",
        requiredFields: ["merchantId", "key"],
      },
    ]);
  });

  it("normalizes live API clearing institute arrays", () => {
    const processors = normalizeCardProcessors({
      data: {
        clearingInstitutes: [
          { id: "CI-1", name: "Processor one", fields: { key: "required" } },
        ],
      },
    });

    expect(processors).toEqual([
      {
        id: "CI-1",
        ciCode: "CI-1",
        name: "Processor one",
        requiredFields: ["key"],
      },
    ]);
  });
});
