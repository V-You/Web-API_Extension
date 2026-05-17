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
          { id: "8a8294175e7a703e015e802ca88315ca", ciCode: "BARCLAYS", name: "Barclays", fields: { key: "required" } },
        ],
      },
    });

    expect(processors).toEqual([
      {
        id: "8a8294175e7a703e015e802ca88315ca",
        ciCode: "BARCLAYS",
        name: "Barclays",
        requiredFields: ["key"],
      },
    ]);
  });

  it("normalizes live API clearingInstitute and internationalCode fields", () => {
    const processors = normalizeCardProcessors({
      data: {
        clearingInstitutes: [
          { id: "8a8294175e7a703e015e802ca88315ca", clearingInstitute: "BARCLAYS_CI", internationalCode: "BARCLAYS" },
        ],
      },
    });

    expect(processors).toEqual([
      {
        id: "8a8294175e7a703e015e802ca88315ca",
        ciCode: "BARCLAYS",
        name: "BARCLAYS_CI",
        requiredFields: [],
      },
    ]);
  });
});
