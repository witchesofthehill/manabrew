import { describe, expect, it } from "vitest";

import { parseCollectionFile, previewCollectionImport } from "@/lib/collectionImport";

function preview(csv: string) {
  const file = parseCollectionFile(csv);
  return previewCollectionImport(file, file.mapping);
}

describe("collection imports", () => {
  it("preserves exact printing and finish identity", () => {
    const [row] = preview(
      "Name,Set code,Collector number,Foil,Quantity\nBlind Obedience,RVR,303,foil,1",
    );

    expect(row).toMatchObject({
      valid: true,
      setCode: "RVR",
      collectorNumber: "303",
      foil: true,
      quantity: 1,
    });
  });

  it("rejects partial printing identity", () => {
    const [row] = preview("Name,Set code,Quantity\nBlind Obedience,RVR,1");

    expect(row).toMatchObject({
      valid: false,
      reason: "Set and collector number must be provided together",
    });
  });

  it("rejects a finish without exact printing identity", () => {
    const [row] = preview("Name,Foil,Quantity\nBlind Obedience,foil,1");

    expect(row).toMatchObject({
      valid: false,
      reason: "Set and collector number are required for card finish",
    });
  });
});
