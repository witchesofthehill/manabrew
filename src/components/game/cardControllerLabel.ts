import type { CardDto } from "@/protocol/game";
import { stripUsernameTag } from "@/lib/username";

export function cardControllerLabel(
  card: CardDto,
  players: readonly { id: string; name: string }[],
): string | null {
  if (!card.attachedTo || card.isFaceDown || ("visibility" in card && card.visibility === "hidden"))
    return null;
  const controller = players.find((player) => player.id === card.controllerId);
  if (!controller) return null;
  const label = `Controller: ${stripUsernameTag(controller.name)}`;
  const owner = players.find((player) => player.id === card.ownerId);
  return owner && owner.id !== controller.id
    ? `${label} · Owner: ${stripUsernameTag(owner.name)}`
    : label;
}
