import brewyBlue from "@/assets/brewy-blue.png";
import brewyPink from "@/assets/brewy-pink.png";
import brewyYellow from "@/assets/brewy-yellow.png";

const BREWY_BOT_AVATARS = [brewyBlue, brewyYellow, brewyPink];

type BotSeat = { username: string; is_bot?: boolean };

export function botAvatarUrls(players: readonly BotSeat[]): Map<string, string> {
  const avatars = new Map<string, string>();
  for (const player of players) {
    if (player.is_bot) {
      avatars.set(player.username, BREWY_BOT_AVATARS[avatars.size % BREWY_BOT_AVATARS.length]);
    }
  }
  return avatars;
}

export function gameBotAvatarUrls(
  players: readonly { id: string; name: string; isHuman: boolean }[],
  roomPlayers: readonly BotSeat[] | undefined,
): Map<string, string> {
  return botAvatarUrls(
    roomPlayers ??
      players
        .filter((player) => !player.isHuman)
        .sort((a, b) => Number(a.id.replace("player-", "")) - Number(b.id.replace("player-", "")))
        .map((player) => ({ username: player.name, is_bot: true })),
  );
}
