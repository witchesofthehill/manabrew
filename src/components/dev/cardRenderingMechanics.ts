import type { ClientCardDto } from "@/stores/gameStore.types";
import type { HandActionOption } from "@/stores/useGameUIStore";
import type { ScryfallCard } from "@/types/scryfall";
import { printedPrototype } from "@/lib/cardPrototype";

import { levelBandActive } from "@/pixi/cardPreview/previewMechanics";
export function cardRenderingMechanicActions(
  card: ClientCardDto,
  info: ScryfallCard,
): HandActionOption[] | undefined {
  const action = (
    value: Omit<HandActionOption, "cardId" | "actionId">,
    index: number,
  ): HandActionOption => ({ ...value, cardId: card.id, actionId: `fixture-mechanic-${index}` });
  if (/\bBattle\b/.test(info.card_faces?.[0]?.type_line ?? info.type_line ?? "")) {
    const faceIndex = card.faceIndex ?? (card.isTransformed ? 1 : 0);
    if (card.zone === "hand")
      return faceIndex === 0
        ? [
            action(
              {
                kind: "cast",
                label: `Cast ${info.card_faces?.[0]?.name ?? info.name}`,
                cost: info.card_faces?.[0]?.mana_cost ?? info.mana_cost,
                faceIndex: 0,
                mode: { type: "normal" },
              },
              0,
            ),
          ]
        : [];
    if (card.zone !== "battlefield") return [];
    const abilities = card.text.split("\n").flatMap((text) => {
      const activated = /^([^:]+):\s*(.+)$/.exec(text);
      return activated ? [{ text, cost: activated[1]!, label: activated[2]! }] : [];
    });
    return abilities.map(({ text, cost, label }, abilityIndex) =>
      action(
        {
          kind: "ability",
          label,
          abilityText: text,
          cost,
          abilityIndex,
          isManaAbility: /^Add\b/.test(label),
        },
        abilityIndex,
      ),
    );
  }
  if (info.layout === "room" || /\bRoom\b/.test(info.type_line ?? "")) {
    return (["left", "right"] as const).flatMap((door, index) => {
      if (
        card.zoneId !== "hand" &&
        (card.unlockedDoors === undefined || card.unlockedDoors.includes(door))
      )
        return [];
      const face = info.card_faces?.[index];
      return [
        action(
          {
            kind: "cast",
            label:
              card.zoneId === "hand"
                ? `Cast ${face?.name ?? door}`
                : `Unlock ${face?.name ?? door}`,
            cost: face?.mana_cost,
            faceIndex: card.zoneId === "hand" && index === 0 ? 0 : undefined,
            mode:
              card.zoneId === "hand"
                ? index === 0
                  ? { type: "normal" }
                  : { type: "roomRightSplit" }
                : { type: "unlockDoor", door },
          },
          index,
        ),
      ];
    });
  }
  if (info.layout === "adventure") {
    if (card.zoneId !== "hand" && card.zoneId !== "exile") return [];
    if (card.zoneId === "exile" && card.isOnAdventure !== true) return [];
    return (card.zoneId === "exile" ? [0] : [0, 1]).map((index) =>
      action(
        {
          kind: "cast",
          label: `Cast ${info.card_faces?.[index]?.name ?? "spell"}`,
          cost: info.card_faces?.[index]?.mana_cost,
          faceIndex: index === 0 ? 0 : undefined,
          mode: index === 1 ? { type: "adventure" } : { type: "normal" },
        },
        index,
      ),
    );
  }
  const prototype = printedPrototype(info.oracle_text ?? "");
  if (prototype && card.zoneId !== "hand") return [];
  if (prototype)
    return [
      action(
        {
          kind: "cast",
          label: "Cast normally",
          cost: info.mana_cost,
          faceIndex: 0,
          mode: { type: "normal" },
        },
        0,
      ),
      action(
        {
          kind: "cast",
          label: "Cast as Prototype",
          cost: prototype.manaCost,
          faceIndex: 0,
          mode: { type: "alternative", cost: "prototype" },
        },
        1,
      ),
    ];
  if (/^Level up\b/m.test(info.oracle_text ?? "")) {
    const actions = [
      action(
        {
          kind: "ability",
          label: "Level up",
          levelUp: "creature",
          abilityIndex: 0,
          abilityText: (info.oracle_text ?? "").split("\n")[0],
        },
        0,
      ),
    ];
    const bands = (info.oracle_text ?? "").split(/^LEVEL\s+([^\n]+)\n/gm);
    for (let index = 1; index < bands.length; index += 2) {
      if (levelBandActive(bands[index]!, card) !== true) continue;
      for (const text of (bands[index + 1] ?? "")
        .split("\n")
        .filter((line) => line.includes(":"))) {
        const abilityIndex = actions.length;
        actions.push(
          action({ kind: "ability", label: text, abilityIndex, abilityText: text }, abilityIndex),
        );
      }
    }
    return actions;
  }
  if (/\bSuspend\b/.test(info.oracle_text ?? ""))
    return card.zoneId === "hand"
      ? [
          action(
            {
              kind: "cast",
              label: "Suspend",
              faceIndex: 0,
              mode: { type: "alternative", cost: "suspend" },
            },
            0,
          ),
        ]
      : [];
  if (/\bCase\b/.test(info.type_line ?? "")) return [];
  return undefined;
}
