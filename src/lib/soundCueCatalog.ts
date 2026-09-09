export const SOUND_ASSETS = {
  gameStart: { alias: "sound-cue.game-start", src: "/sounds/game-start.wav" },
  turnStart: { alias: "sound-cue.turn-start", src: "/sounds/turn-start.wav" },
  cardPlay: { alias: "sound-cue.card-play", src: "/sounds/card-play.wav" },
  cardDraw: { alias: "sound-cue.card-draw", src: "/sounds/card-draw.wav" },
  cardTap: { alias: "sound-cue.card-tap", src: "/sounds/card-tap.wav" },
  cardUntap: { alias: "sound-cue.card-untap", src: "/sounds/card-untap.wav" },
  cardDiscard: { alias: "sound-cue.card-discard", src: "/sounds/card-discard.wav" },
  cardDestroy: { alias: "sound-cue.card-destroy", src: "/sounds/card-destroy.wav" },
  cardExile: { alias: "sound-cue.card-exile", src: "/sounds/card-exile.wav" },
  shuffle: { alias: "sound-cue.shuffle", src: "/sounds/shuffle.wav" },
  lifeGain: { alias: "sound-cue.life-gain", src: "/sounds/life-gain.wav" },
  lifeLoss: { alias: "sound-cue.life-loss", src: "/sounds/life-loss.wav" },
  diceRoll: { alias: "sound-cue.dice-roll", src: "/sounds/dice-roll.wav" },
  prompt: { alias: "sound-cue.prompt", src: "/sounds/prompt.wav" },
  error: { alias: "sound-cue.error", src: "/sounds/error.wav" },
} as const;

export type SoundAssetKey = keyof typeof SOUND_ASSETS;

export interface SoundCueDefinition {
  variants: readonly SoundAssetKey[];
  voiceLimit: number;
  cooldownMs: number;
  volume: number;
}

export const SOUND_CUES: Record<string, SoundCueDefinition> = {
  "game.card.draw": {
    variants: ["cardDraw"],
    voiceLimit: 4,
    cooldownMs: 40,
    volume: 0.7,
  },
  "game.card.play": {
    variants: ["cardPlay"],
    voiceLimit: 3,
    cooldownMs: 70,
    volume: 0.8,
  },
  "game.card.tap": {
    variants: ["cardTap"],
    voiceLimit: 4,
    cooldownMs: 35,
    volume: 0.65,
  },
  "game.card.untap": {
    variants: ["cardUntap"],
    voiceLimit: 4,
    cooldownMs: 35,
    volume: 0.65,
  },
  "game.card.discard": {
    variants: ["cardDiscard"],
    voiceLimit: 3,
    cooldownMs: 70,
    volume: 0.75,
  },
  "game.card.destroy": {
    variants: ["cardDestroy"],
    voiceLimit: 3,
    cooldownMs: 80,
    volume: 0.8,
  },
  "game.card.exile": {
    variants: ["cardExile"],
    voiceLimit: 3,
    cooldownMs: 80,
    volume: 0.75,
  },
  "game.library.shuffle": {
    variants: ["shuffle"],
    voiceLimit: 1,
    cooldownMs: 300,
    volume: 0.65,
  },
  "game.player.life-gain": {
    variants: ["lifeGain"],
    voiceLimit: 3,
    cooldownMs: 80,
    volume: 0.7,
  },
  "game.player.life-loss": {
    variants: ["lifeLoss"],
    voiceLimit: 3,
    cooldownMs: 80,
    volume: 0.75,
  },
  "game.turn.start": {
    variants: ["turnStart"],
    voiceLimit: 1,
    cooldownMs: 250,
    volume: 0.75,
  },
  "game.random.die-roll": {
    variants: ["diceRoll"],
    voiceLimit: 2,
    cooldownMs: 120,
    volume: 0.7,
  },
  "game.start": {
    variants: ["gameStart"],
    voiceLimit: 1,
    cooldownMs: 500,
    volume: 0.8,
  },
  "prompt.decision-required": {
    variants: ["prompt"],
    voiceLimit: 1,
    cooldownMs: 250,
    volume: 0.65,
  },
  "prompt.target-required": {
    variants: ["prompt"],
    voiceLimit: 1,
    cooldownMs: 250,
    volume: 0.65,
  },
  "prompt.payment-required": {
    variants: ["prompt"],
    voiceLimit: 1,
    cooldownMs: 250,
    volume: 0.65,
  },
  "prompt.combat-required": {
    variants: ["prompt"],
    voiceLimit: 1,
    cooldownMs: 250,
    volume: 0.65,
  },
  "prompt.action-rejected": {
    variants: ["error"],
    voiceLimit: 1,
    cooldownMs: 250,
    volume: 0.75,
  },
};
