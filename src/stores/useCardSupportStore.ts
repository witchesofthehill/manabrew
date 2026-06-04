import { create } from "zustand";
import { getPlatform } from "@/platform";

type Status = "supported" | "unsupported" | "pending";

interface CardSupportState {
  status: Record<string, Status>;
  ensureChecked: (names: string[]) => Promise<void>;
}

function normalize(name: string): string {
  return name.toLowerCase();
}

export const useCardSupportStore = create<CardSupportState>((set, get) => ({
  status: {},
  ensureChecked: async (names) => {
    const current = get().status;
    const toCheck: string[] = [];
    const seen = new Set<string>();
    for (const raw of names) {
      const key = normalize(raw);
      if (seen.has(key)) continue;
      seen.add(key);
      if (current[key] === undefined) toCheck.push(raw);
    }
    if (toCheck.length === 0) return;

    set((s) => {
      const next = { ...s.status };
      for (const raw of toCheck) next[normalize(raw)] = "pending";
      return { status: next };
    });

    const platform = getPlatform();
    const results = await Promise.all(
      toCheck.map(async (raw) => {
        try {
          const ok = await platform.invoke<boolean>("is_card_supported", { name: raw });
          return [normalize(raw), ok ? "supported" : "unsupported"] as const;
        } catch (err) {
          console.warn("[card-support] check failed for", raw, err);
          return [normalize(raw), "supported"] as const;
        }
      }),
    );

    set((s) => {
      const next = { ...s.status };
      for (const [key, value] of results) next[key] = value;
      return { status: next };
    });
  },
}));

export function selectUnsupportedNames(
  state: CardSupportState,
  names: Iterable<string>,
): Set<string> {
  const out = new Set<string>();
  for (const raw of names) {
    if (state.status[normalize(raw)] === "unsupported") out.add(raw);
  }
  return out;
}

export function useIsUnsupported(name: string): boolean {
  return useCardSupportStore((s) => s.status[normalize(name)] === "unsupported");
}
