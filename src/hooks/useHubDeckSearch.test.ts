/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchHubDecks: vi.fn(),
}));

vi.mock("@/api/hub", () => ({
  fetchHubDecks: mocks.fetchHubDecks,
}));

vi.mock("@/featureFlags", () => ({
  isFeatureEnabled: () => true,
}));

import { useHubDeckSearch } from "./useHubDeckSearch";

function Harness({ active }: { active: boolean }) {
  useHubDeckSearch("", "commander", active);
  return null;
}

describe("useHubDeckSearch", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchHubDecks.mockResolvedValue({
      decks: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not request decks until its owning dialog is open", async () => {
    await act(async () => root.render(createElement(Harness, { active: false })));
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.fetchHubDecks).not.toHaveBeenCalled();

    await act(async () => root.render(createElement(Harness, { active: true })));
    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(mocks.fetchHubDecks).toHaveBeenCalledOnce();
    expect(mocks.fetchHubDecks).toHaveBeenCalledWith({
      search: undefined,
      format: "commander",
      sort: "newest",
      page: 1,
      pageSize: 10,
    });
  });
});
