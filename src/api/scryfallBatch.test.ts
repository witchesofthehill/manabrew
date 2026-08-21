import { afterAll, describe, expect, it, vi } from "vitest";

import {
  canonicalCardName,
  matchesIdentifier,
  normalizeIdentifierForRequest,
} from "./scryfallBatch";
import type { ScryfallCard } from "@/types/scryfall";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));

afterAll(() => vi.unstubAllGlobals());

const boggartTrawler = {
  name: "Boggart Trawler // Boggart Bog",
  set: "mh3",
  collector_number: "243",
  card_faces: [{ name: "Boggart Trawler" }, { name: "Boggart Bog" }],
} as ScryfallCard;

describe("Scryfall card identifiers", () => {
  it("canonicalizes the single and double slash forms used by deck platforms", () => {
    expect(canonicalCardName("Boggart Trawler / Boggart Bog")).toBe(
      "boggart trawler // boggart bog",
    );
    expect(matchesIdentifier(boggartTrawler, { name: "Boggart Trawler / Boggart Bog" })).toBe(true);
    expect(matchesIdentifier(boggartTrawler, { name: "Boggart Trawler" })).toBe(true);
  });

  it("sends only the front face for collection name lookups", () => {
    expect(normalizeIdentifierForRequest({ name: "Boggart Trawler / Boggart Bog" })).toEqual({
      name: "Boggart Trawler",
    });
  });
});
