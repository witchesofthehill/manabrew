import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLimitedOpeningStore } from "@/components/limited/limitedOpeningStore";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { refToDeckCard } from "@/lib/limited.utils";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { SealedPool } from "@/types/limited";

const NO_OPENED_PACKS: string[] = [];
const BOOSTER_REVEAL_MS = 1700;

export function useLimitedPackOpening(
  sessionKey: string,
  packs: SealedPool["packs"],
  onComplete: () => void,
) {
  const saved = useLimitedOpeningStore((state) => state.sessions[sessionKey]);
  const open = useLimitedOpeningStore((state) => state.open);
  const openedIds = saved?.openedIds ?? NO_OPENED_PACKS;
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [openAll, setOpenAll] = useState(false);
  const [arrival, setArrival] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [imageError, setImageError] = useState(false);
  const generation = useRef(0);
  const timer = useRef<number | null>(null);
  const settle = useRef<((completed: boolean) => void) | null>(null);
  const callback = useRef(onComplete);
  useLayoutEffect(() => {
    callback.current = onComplete;
  }, [onComplete]);
  const delivered = useRef<string | null>(null);
  const nextPack = packs.find((pack) => !openedIds.includes(pack.id));
  const activePack =
    packs.find((pack) => pack.id === reviewId) ?? packs.find((pack) => openedIds.includes(pack.id));
  const openedCount = packs.filter((pack) => openedIds.includes(pack.id)).length;
  const cancel = useCallback(() => {
    generation.current += 1;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    settle.current?.(false);
    settle.current = null;
  }, []);
  const reveal = async (pack: SealedPool["packs"][number]): Promise<boolean> => {
    cancel();
    const current = generation.current;
    setPreparing(true);
    const results = await Promise.allSettled(
      pack.cards.map(async (card) => {
        const store = useScryfallStore.getState();
        const entry = await store.getCard({
          name: card.name,
          setCode: card.setCode,
          cardNumber: card.cardNumber,
        });
        const deckCard = refToDeckCard(card, entry);
        await store.getCardTexture(deckCard);
      }),
    );
    if (generation.current !== current) return false;
    setImageError(results.some((result) => result.status === "rejected"));
    setPreparing(false);
    setReviewId(pack.id);
    setArrival((value) => value + 1);
    setRevealing(true);
    open(sessionKey, [pack.id]);
    return new Promise<boolean>((resolve) => {
      settle.current = resolve;
      timer.current = window.setTimeout(
        () => {
          timer.current = null;
          settle.current = null;
          setRevealing(false);
          resolve(true);
        },
        animationsEnabled() ? BOOSTER_REVEAL_MS : 0,
      );
    });
  };
  const openRemaining = async () => {
    setOpenAll(true);
    for (const pack of packs.filter((pack) => !openedIds.includes(pack.id))) {
      if (!(await reveal(pack))) return;
    }
    setOpenAll(false);
  };
  const review = (id: string) => {
    setReviewId(id);
    setRevealing(false);
  };
  const complete = () => {
    cancel();
    setPreparing(false);
    setOpenAll(false);
    setRevealing(false);
    open(
      sessionKey,
      packs.map((pack) => pack.id),
      true,
    );
  };
  useEffect(() => {
    if (saved?.completed && delivered.current !== sessionKey) {
      delivered.current = sessionKey;
      callback.current();
    }
  }, [saved?.completed, sessionKey]);
  useEffect(() => cancel, [cancel]);
  return {
    openedIds,
    openedCount,
    nextPack,
    activePack,
    preparing,
    revealing,
    openAll,
    imageError,
    arrival,
    reveal,
    openRemaining,
    review,
    complete,
  };
}
