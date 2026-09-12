import * as THREE from "three";
import type { ArenaSceneProps } from "@/three/arena.types";

type Strike = {
  start: number;
  direction: THREE.Vector3;
  defender: boolean;
  target?: THREE.Vector3;
  player?: string;
  flashed?: boolean;
};
export function combatMotion() {
  let previous: ArenaSceneProps | undefined;
  let lastDamage = "";
  const strikes = new Map<string, Strike>();
  return {
    update(
      current: ArenaSceneProps,
      time: number,
      positions: Map<string, { x: number; z: number }>,
    ) {
      for (const [id, strike] of strikes) if (time > strike.start + 1050) strikes.delete(id);
      const step = current.combatStep ?? "";
      const damage = step === "combatDamage" || step === "combatFirstStrikeDamage";
      const skipped =
        previous?.combatStep?.startsWith("combat") &&
        !previous.combatStep.includes("Damage") &&
        (step === "combatEnd" || step === "main2");
      const key = `${current.combatTurn ?? ""}:${damage ? step : "combatDamage"}`;
      if ((damage || skipped) && key !== lastDamage && previous) {
        const previousDamage = lastDamage;
        lastDamage = key;
        const combatants = new Map([...previous.cards, ...current.cards].map((c) => [c.id, c]));
        const attackers = [...combatants.values()].filter((c) => c.attacking);
        // State-based deaths can already be absent in the damage snapshot.
        for (const c of previous.cards)
          if (c.attacking && !attackers.some((a) => a.id === c.id)) attackers.push(c);
        const links = current.links?.length ? current.links : previous.links;
        const firstStrike = step === "combatFirstStrikeDamage";
        const afterFirstStrike = previousDamage.endsWith(":combatFirstStrikeDamage");
        attackers
          .filter((card) => {
            const first = /first strike/i.test(card.text);
            const double = /double strike/i.test(card.text);
            return firstStrike ? first || double : !afterFirstStrike || !first || double;
          })
          .forEach((card, i) => {
            const a = positions.get(card.id);
            if (!a) return;
            const blockers = (links ?? []).flatMap((l) =>
              l.to === card.id ? [l] : l.from === card.id ? [{ ...l, from: l.to, to: l.from }] : [],
            );
            const player = blockers.length
              ? undefined
              : (card.attackingPlayerId ?? (card.side === "self" ? "opponent" : "self"));
            const b = positions.get(blockers.length ? blockers[0].from : `player:${player}`);
            const direction = new THREE.Vector3(
              b ? b.x - a.x : 0,
              0,
              b ? b.z - a.z : card.side === "self" ? -4 : 4,
            );
            if (!player)
              direction.clampLength(0, b ? Math.max(0.5, direction.length() - 1.4) : 3.1);
            const start = time + Math.min(i, 5) * 65;
            strikes.set(card.id, {
              start,
              direction,
              defender: false,
              player,
              target: new THREE.Vector3(b?.x ?? a.x + direction.x, 0.8, b?.z ?? a.z + direction.z),
            });
            for (const blocker of blockers)
              strikes.set(blocker.from, {
                start,
                direction: direction.clone().normalize().multiplyScalar(0.42),
                defender: true,
              });
          });
      }
      if (!step.startsWith("combat") && step !== "main2") lastDamage = "";
      previous = current;
    },
    apply(id: string, mesh: THREE.Mesh, time: number, reduced: boolean) {
      const strike = strikes.get(id);
      if (!strike || reduced) return;
      const t = (time - strike.start) / 1000;
      if (t < 0) return;
      if (t > 1.05) {
        strikes.delete(id);
        return;
      }
      // Anticipation, fast contact at 340ms, short bounce, then settle.
      const amount = strike.defender
        ? t < 0.34
          ? 0
          : Math.sin(Math.min(1, (t - 0.34) / 0.65) * Math.PI) * Math.exp(-(t - 0.34) * 2)
        : t < 0.16
          ? -0.09 * Math.sin(((t / 0.16) * Math.PI) / 2)
          : t < 0.34
            ? -0.09 + 1.09 * Math.pow((t - 0.16) / 0.18, 2)
            : Math.exp(-(t - 0.34) * 5) * Math.cos((t - 0.34) * 8);
      mesh.position.addScaledVector(strike.direction, amount);
      mesh.position.y += strike.defender
        ? Math.abs(amount) * 0.12
        : Math.sin(Math.min(1, t / 1.05) * Math.PI) * 0.48;
      mesh.rotation.x += amount * (strike.defender ? -0.07 : 0.1) * Math.sign(strike.direction.z);
    },
    impact(id: string, time: number) {
      const strike = strikes.get(id);
      if (!strike || strike.defender || strike.flashed || time < strike.start + 340) return false;
      strike.flashed = true;
      return time < strike.start + 500
        ? { position: strike.target!, player: strike.player }
        : false;
    },
    remaining(id: string, time: number) {
      return Math.max(0, (strikes.get(id)?.start ?? -Infinity) + 1050 - time);
    },
    active(id: string, time: number) {
      const s = strikes.get(id);
      return !!s && time < s.start + 1050;
    },
  };
}
