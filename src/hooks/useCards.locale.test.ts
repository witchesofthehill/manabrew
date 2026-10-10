import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCardSearch } from "@/hooks/useCards";

const store = vi.hoisted(() => {
  let locale = "en";
  const listeners = new Set<() => void>();
  const searchCards = vi.fn(async () => ({
    object: "list",
    total_cards: 1,
    has_more: false,
    data: [{ lang: locale, name: "Lightning Bolt", printed_name: locale === "it" ? "Fulmine" : undefined }],
  }));
  return {
    get locale() {
      return locale;
    },
    searchCards,
    setLocale(next: string) {
      locale = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock("@/stores/useScryfallStore", () => ({
  useScryfallStore: Object.assign(
    (selector: (state: { locale: string }) => unknown) =>
      useSyncExternalStore(store.subscribe, () => selector({ locale: store.locale })),
    { getState: () => ({ locale: store.locale, searchCards: store.searchCards }) },
  ),
}));

import { useSyncExternalStore } from "react";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root;
let container: HTMLDivElement;
let result: ReturnType<typeof useCardSearch> | undefined;

function SearchProbe() {
  result = useCardSearch("Fulmine");
  return null;
}

describe("useCardSearch locale updates", () => {
  beforeEach(() => {
    store.setLocale("en");
    store.searchCards.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
    result = undefined;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("reruns the same search after the app language changes", async () => {
    await act(async () => {
      root.render(createElement(SearchProbe));
      await Promise.resolve();
    });

    expect(store.searchCards).toHaveBeenCalledTimes(1);
    expect(result?.data?.pages[0].data[0]).toMatchObject({ lang: "en" });

    await act(async () => {
      store.setLocale("it");
      await Promise.resolve();
    });

    expect(store.searchCards).toHaveBeenCalledTimes(2);
    expect(store.searchCards).toHaveBeenLastCalledWith("Fulmine", 1, undefined, undefined);
    expect(result?.data?.pages[0].data[0]).toMatchObject({ lang: "it", printed_name: "Fulmine" });
  });
});
