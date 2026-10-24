import type { GameViewTransition } from "@/lib/gameViewTransitions";
import { loadSoundAsset, logSoundPlayback } from "@/lib/soundRuntime";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export type GameSound = Exclude<GameViewTransition["kind"], "turnStart"> | "cardEnter" | "priority";

function gameSound(name: string, volume: number) {
  return { alias: `sound.game.${name}`, src: `/sounds/${name}.wav`, volume };
}

const GAME_SOUNDS: Record<GameSound, ReturnType<typeof gameSound>> = {
  cardPlay: gameSound("card-play", 0.7),
  cardEnter: gameSound("card-etb", 0.7),
  cardTap: gameSound("", 0.0),
  cardUntap: gameSound("", 0.0),
  cardAttach: gameSound("", 0.0),
  cardTransform: gameSound("", 0.0),
  tokenCreate: gameSound("card-etb", 0.7),
  cardDiscard: gameSound("wood-heavy", 0.75),
  cardDestroy: gameSound("wood-heavy", 0.8),
  cardExile: gameSound("wood-heavy", 0.75),
  cardCounterAdd: gameSound("", 0.0),
  cardCounterRemove: gameSound("", 0.0),
  cardDamage: gameSound("", 0.0),
  instantResolve: gameSound("spell-resolve", 0.7),
  sorceryResolve: gameSound("spell-resolve", 0.7),
  lifeGain: gameSound("", 0.0),
  lifeLoss: gameSound("", 0.0),
  combatBlock: gameSound("", 0.0),
  outcomeWin: gameSound("", 0.0),
  outcomeLoss: gameSound("", 0.0),
  priority: gameSound("", 0.0),
};

export function playGameSounds(sounds: readonly GameSound[]): void {
  if (usePreferencesStore.getState().soundMuted) return;
  for (const name of new Set(sounds)) {
    const definition = GAME_SOUNDS[name];
    void loadSoundAsset(definition).then((soundAsset) => {
      if (!soundAsset || usePreferencesStore.getState().soundMuted) return;
      try {
        void Promise.resolve(soundAsset.play({ volume: definition.volume }))
          .then(() => logSoundPlayback(definition.src, name))
          .catch(() => undefined);
      } catch {
        return;
      }
    });
  }
}
