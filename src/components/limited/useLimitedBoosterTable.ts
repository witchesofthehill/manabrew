import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Container } from "pixi.js";
import { LimitedBoosterReveal } from "@/pixi/limited/LimitedBoosterReveal";
import type {
  BoosterOpeningPacket,
  BoosterTearDirection,
} from "@/pixi/limited/LimitedBoosterReveal";
import { acquireLimitedRenderer } from "@/pixi/limited/LimitedRenderer";
import type { LimitedPane } from "@/pixi/limited/LimitedRenderer";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";
import { subscribeTheme } from "@/hooks/useTheme";
import { useScryfallStore } from "@/stores/useScryfallStore";
import type { LimitedBoosterControlHandle } from "@/components/limited/LimitedBoosterControl";
import type { SealedPool } from "@/types/limited";

export function useLimitedBoosterTable(
  packs: SealedPool["packs"],
  openedIds: readonly string[],
  openingIds: readonly string[],
  disabled: boolean,
  onOpen: (
    ids: string[],
    direction: BoosterTearDirection | undefined,
    capture: () => BoosterOpeningPacket[],
  ) => void,
) {
  const host = useRef<HTMLDivElement>(null);
  const control = useRef<LimitedBoosterControlHandle>(null);
  const packets = useRef(new Map<string, LimitedBoosterReveal>());
  const reset = useCallback(() => control.current?.reset(), []);
  const onTear = useCallback(
    (id: string, progress: number, direction?: BoosterTearDirection) =>
      packets.current.get(id)?.tear(progress, direction),
    [],
  );
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const stages = useRef(new Map<string, Container>());
  const hidden = useRef(openingIds);
  const request = useRef<(() => void) | null>(null);
  const sets = useScryfallStore((state) => state.sets);
  const unopened = useMemo(
    () =>
      packs
        .map((pack, index) => ({ pack, number: index + 1 }))
        .filter(({ pack }) => !openedIds.includes(pack.id))
        .map((entry, index, remaining) => ({
          ...entry,
          angle: (index - (remaining.length - 1) / 2) * 0.04,
        })),
    [packs, openedIds],
  );
  useLayoutEffect(() => {
    hidden.current = openingIds;
    request.current?.();
  }, [openingIds]);
  const open = (ids: string[], direction?: BoosterTearDirection) => {
    onOpen(ids, direction, () =>
      unopened
        .filter(({ pack }) => ids.includes(pack.id))
        .flatMap(({ pack, angle }) => {
          const button = buttons.current.get(pack.id);
          if (!button) return [];
          const rect = button.getBoundingClientRect();
          return [
            {
              packId: pack.id,
              cardIds: pack.cards.map((card) => card.id),
              setCode: pack.setCode,
              origin: {
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                width: button.clientWidth * 0.94,
                height: button.clientHeight * 0.96,
                rotation: angle,
              },
            },
          ];
        }),
    );
  };
  useLayoutEffect(() => {
    if (!disabled) return;
    for (const [id, stage] of stages.current) {
      gsap.killTweensOf(stage);
      const button = buttons.current.get(id);
      if (button) stage.y = button.offsetTop;
    }
    request.current?.();
  }, [disabled]);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const root = new Container();
    root.eventMode = "none";
    let dimensions = "";
    const clear = () => {
      for (const packet of packets.current.values()) packet.finish();
      for (const stage of stages.current.values()) gsap.killTweensOf(stage);
      packets.current.clear();
      stages.current.clear();
      for (const child of root.removeChildren()) child.destroy({ children: true });
    };
    const pane: LimitedPane = {
      host: element,
      root,
      layer: "decoration",
      frame: () => {
        let active = false;
        for (const packet of packets.current.values()) {
          if (!animationsEnabled()) packet.reduceMotion();
          active = packet.animating || active;
        }
        return active;
      },
      layout: () => {
        for (const [id, stage] of stages.current) stage.visible = !hidden.current.includes(id);
        const next = unopened
          .map(({ pack }) => {
            const button = buttons.current.get(pack.id);
            return button
              ? `${button.offsetLeft}:${button.offsetTop}:${button.clientWidth}:${button.clientHeight}`
              : "";
          })
          .join("|");
        if (dimensions === next || !element.clientWidth || !element.clientHeight) return false;
        dimensions = next;
        clear();
        for (const { pack, angle } of unopened) {
          const button = buttons.current.get(pack.id);
          if (!button) continue;
          const stage = new Container();
          stage.position.set(button.offsetLeft, button.offsetTop);
          stage.visible = !hidden.current.includes(pack.id);
          stages.current.set(pack.id, stage);
          root.addChild(stage);
          const packet = new LimitedBoosterReveal(stage, renderer.request);
          packets.current.set(pack.id, packet);
          packet.play([], button.clientWidth, button.clientHeight, {
            backdrop: false,
            cardCount: pack.cards.length,
            setCode: pack.setCode,
            set: sets.find((set) => set.code === pack.setCode?.toLowerCase()),
            origin: {
              x: button.clientWidth / 2,
              y: button.clientHeight / 2,
              width: button.clientWidth * 0.94,
              height: button.clientHeight * 0.96,
              rotation: angle,
            },
          });
        }
        return true;
      },
    };
    const renderer = acquireLimitedRenderer(pane);
    request.current = renderer.request;
    const invalidate = () => {
      reset();
      dimensions = "";
      renderer.request();
    };
    const resize = new ResizeObserver(invalidate);
    resize.observe(element);
    const unsubscribe = subscribeTheme(invalidate);
    void renderer.ready.then(renderer.request);
    return () => {
      resize.disconnect();
      unsubscribe();
      reset();
      clear();
      request.current = null;
      renderer.release(pane);
      root.destroy({ children: true });
    };
  }, [unopened, sets, packets, reset]);
  const hover = (id: string, active: boolean) => {
    const stage = stages.current.get(id);
    const button = buttons.current.get(id);
    if (!stage || !button || disabled || control.current?.dragging()) return;
    packets.current.get(id)?.tear(active ? 0.08 : 0);
    gsap.killTweensOf(stage);
    if (!animationsEnabled()) {
      stage.y = button.offsetTop;
      request.current?.();
      return;
    }
    gsap.to(stage, {
      y: button.offsetTop - (active ? 8 : 0),
      duration: 0.16,
      ease: "power2.out",
      onUpdate: request.current ?? undefined,
    });
  };
  return {
    host,
    buttons,
    unopened,
    control,
    onOpen: open,
    onTear,
    open: (ids: string[], direction?: BoosterTearDirection) =>
      control.current?.open(ids, direction),
    hover,
  };
}
