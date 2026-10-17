import { describe, expect, it } from "vitest";
import {
  shouldLocalizeScryfallSearchResults,
  withAnyScryfallLanguage,
} from "@/lib/scryfallSearch";

describe("Scryfall search language filters", () => {
  it("preserves language aliases and negated filters inside groups", () => {
    const query = "Lightning Bolt (language:it or -lang:es)";

    expect(withAnyScryfallLanguage(query)).toBe(query);
    expect(shouldLocalizeScryfallSearchResults(query)).toBe(false);
  });

  it("preserves a negated language filter", () => {
    const query = "Lightning Bolt -lang:it";

    expect(withAnyScryfallLanguage(query)).toBe(query);
    expect(shouldLocalizeScryfallSearchResults(query)).toBe(false);
  });

  it("keeps lang:any explicit while still allowing active-locale localization", () => {
    const query = "Lightning Bolt language:any";

    expect(withAnyScryfallLanguage(query)).toBe(query);
    expect(shouldLocalizeScryfallSearchResults(query)).toBe(true);
  });

  it("adds lang:any to a query without a language clause", () => {
    expect(withAnyScryfallLanguage("  Fulmine  ")).toBe("Fulmine lang:any");
    expect(shouldLocalizeScryfallSearchResults("Fulmine")).toBe(true);
  });
});
