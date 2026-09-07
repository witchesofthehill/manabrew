import { arenaSurface } from "@/themes/arenaSurface";
import { SpellStack } from "@/three/SpellStack";
import { TargetChoices } from "@/three/TargetChoices";
import "@/three/duel.css";
import { CardPreview } from "@/three/CardPreview";
import { CardActionPicker } from "@/three/CardActionPicker";
import type { AvailableAction } from "@manabrew/protocol";
import { useMemo, useState } from "react";

import type { CSSProperties } from "react";
import { ArenaScene } from "@/three/ArenaScene";
import type { ArenaCard, ArenaColors } from "@/three/arena.types";
import preset from "@/themes/kanagawa";
import "@/three/arena.css";

const colors: ArenaColors = arenaSurface;
const styles = Object.fromEntries(
  Object.entries(colors).map(([key, value]) => [`--arena-${key}`, value]),
) as CSSProperties;
const makeCard = (
  id: string,
  name: string,
  side: ArenaCard["side"],
  type: string,
  stats?: string,
  text = "",
): ArenaCard => ({
  id,
  name,
  side,
  type,
  stats,
  text,
  cost: "",
  frame: side === "opponent" ? "G" : "U",
  color: side === "opponent" ? preset.gameColors["mana.G"] : colors.accent,
  image: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=large`,
  artImage: `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=art_crop`,
  playable: side === "hand",
});
const initial: ArenaCard[] = [
  makeCard(
    "o1",
    "Regisaur Alpha",
    "opponent",
    "Creature — Dinosaur",
    "4/4",
    "Other Dinosaurs you control have haste.",
  ),
  makeCard(
    "o2",
    "Drover of the Mighty",
    "opponent",
    "Creature — Human Druid",
    "1/1",
    "Add one mana of any color.",
  ),
  ...Array.from({ length: 3 }, (_, i) =>
    makeCard(`forest${i}`, "Forest", "opponent", "Basic Land — Forest"),
  ),
  makeCard(
    "p1",
    "Storm Fleet Aerialist",
    "self",
    "Creature — Human Pirate",
    "2/3",
    "Flying. Raid — enters with a +1/+1 counter if you attacked this turn.",
  ),
  makeCard(
    "p2",
    "Siren Stormtamer",
    "self",
    "Creature — Siren Pirate Wizard",
    "1/1",
    "Flying. Sacrifice to counter a spell or ability targeting you or a creature you control.",
  ),
  ...Array.from({ length: 3 }, (_, i) =>
    makeCard(`island${i}`, "Island", "self", "Basic Land — Island"),
  ),
  makeCard("h1", "Opt", "hand", "Instant", undefined, "Scry 1. Draw a card."),
  makeCard(
    "h2",
    "Storm Fleet Spy",
    "hand",
    "Creature — Human Pirate",
    "2/2",
    "Raid — When this enters, if you attacked this turn, draw a card.",
  ),
  makeCard("h3", "Island", "hand", "Basic Land — Island"),
];

export function ArenaPlayground() {
  const targetDemo = new URLSearchParams(location.search).get("layout") === "targets";
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const abilityDemo = new URLSearchParams(location.search).get("layout") === "abilities";
  const [abilitiesOpen, setAbilitiesOpen] = useState(abilityDemo);
  const demoActions: AvailableAction[] = [
    ["{R}", "All creatures gain trample and haste until end of turn."],
    ["{1}{G}", "Put a +1/+1 counter on target creature."],
    ["{2}{W}", "Target player gains 5 life."],
    ["{3}{U}", "Target player draws a card."],
    [
      "{4}{B}",
      "Put target creature card from a graveyard onto the battlefield under its owner's control.",
    ],
  ].map(([cost, description], abilityIndex) => ({
    id: `demo-${abilityIndex}`,
    cardId: "p1",
    type: "activateAbility",
    isManaAbility: false,
    abilityIndex,
    cost,
    description,
  }));
  const [cards, setCards] = useState(() => {
    if (new URLSearchParams(location.search).get("layout") === "auras")
      return [
        ...initial.map((card) =>
          card.id.startsWith("island")
            ? makeCard(card.id, "Forest", "self", "Basic Land — Forest")
            : card,
        ),
        {
          ...makeCard("aura-self", "Utopia Sprawl", "self", "Enchantment — Aura"),
          attachedTo: "island0",
        },
        {
          ...makeCard("aura-enemy", "Wild Growth", "opponent", "Enchantment — Aura"),
          attachedTo: "forest0",
        },
      ];
    if (new URLSearchParams(location.search).get("layout") === "lands")
      return [
        ...initial,
        ...Array.from({ length: 7 }, (_, i) => ({
          ...makeCard(`enemy-hand-${i}`, "Hidden card", "opponentHand", ""),
          image: undefined,
          artImage: undefined,
          hidden: true,
        })),
        ...Array.from({ length: 4 }, (_, i) => ({
          ...makeCard(`enemy-tapped-${i}`, "Forest", "opponent", "Basic Land — Forest"),
          tapped: true,
        })),
      ];
    if (abilityDemo)
      return initial.map((c) =>
        c.id === "p1"
          ? {
              ...makeCard(
                "p1",
                "Kenrith, the Returned King",
                "self",
                "Legendary Creature — Human Noble",
                "5/5",
              ),
              actionCount: 5,
              playable: true,
            }
          : c,
      );
    if (new URLSearchParams(location.search).get("layout") === "combat")
      return initial.map((c) =>
        c.id === "p1"
          ? {
              ...c,
              keywords: ["Flying", "Vigilance"],
              counters: { P1P1: 2 },
              stats: "3/4",
              statsChanged: true,
              damage: 1,
              attacking: true,
              attackTargetId: "o1",
            }
          : c.id === "p2"
            ? { ...c, keywords: ["Flying"] }
            : c,
      );
    if (new URLSearchParams(location.search).get("layout") !== "multiplayer") return initial;
    return [
      ...initial.filter((card) => card.side !== "opponent"),
      ...[3, 6, 9].flatMap((count, seat) => {
        const playerId = `player-${seat + 1}`;
        return [
          ...Array.from({ length: count }, (_, i) => ({
            ...makeCard(
              `${playerId}-creature-${i}`,
              ["Silvercoat Lion", "Standing Troops", "Savannah Lions"][i % 3],
              "opponent",
              "Creature",
              "2/2",
            ),
            playerId,
          })),
          ...Array.from({ length: 8 }, (_, i) => ({
            ...makeCard(`${playerId}-land-${i}`, "Plains", "opponent", "Basic Land"),
            tapped: i < 4,
            playerId,
          })),
          ...Array.from({ length: 7 }, (_, i) => ({
            ...makeCard(`${playerId}-hand-${i}`, "Hidden card", "opponentHand", ""),
            image: undefined,
            artImage: undefined,
            hidden: true,
            playerId,
          })),
        ];
      }),
    ];
  });
  const [phase, setPhase] = useState("Main phase");
  const [life, setLife] = useState(20);
  const [hover, setHover] = useState<string | null>(null);
  const [log, setLog] = useState("Play a card from your hand. Click a land to tap it.");
  const [drawCount, setDrawCount] = useState(0);
  const [links, setLinks] = useState<{ from: string; to: string; color: string }[]>([]);
  const selected = cards.find((c) => c.id === (abilitiesOpen ? "p1" : hover));
  const attackers = cards.filter((c) => c.attacking && c.side === "self");
  const click = (id: string) => {
    if (targetDemo) {
      if (["p1", "o1"].includes(id))
        setTargetIds((old) =>
          old.includes(id) ? old.filter((target) => target !== id) : [...old, id],
        );
      return;
    }
    if (abilityDemo && id === "p1") {
      setAbilitiesOpen(true);
      return;
    }
    const card = cards.find((c) => c.id === id);
    if (!card) return;
    if (card.side === "hand") {
      if (card.type === "Instant") {
        setCards((old) => old.filter((c) => c.id !== id));
        setLog(`${card.name} animation preview. Use Draw to add another card.`);
      } else {
        setCards((old) =>
          old.map((c) => (c.id === id ? { ...c, side: "self", playable: false } : c)),
        );
        setLog(`${card.name} entered the battlefield.`);
      }
    } else if (card.side === "self") {
      setCards((old) =>
        old.map((c) =>
          c.id === id
            ? /Land/.test(c.type)
              ? { ...c, tapped: !c.tapped }
              : phase === "Combat"
                ? { ...c, attacking: !c.attacking, selected: !c.selected }
                : c
            : c,
        ),
      );
      setLog(
        /Land/.test(card.type)
          ? `${card.name} ${card.tapped ? "untapped" : "tapped"}.`
          : phase === "Combat"
            ? `${card.name} ${card.attacking ? "removed from combat" : "selected to attack"}.`
            : "Enter Combat, then click creatures to declare attackers.",
      );
    }
  };
  const next = () => {
    setLinks([]);
    if (phase === "Main phase") {
      setPhase("Combat");
      setLog("Select attackers. Drag an attacker onto a defender to preview a combat link.");
    } else if (phase === "Combat") {
      const damage = attackers.reduce(
        (total, card) => total + Number(card.stats?.split("/")[0] ?? 0),
        0,
      );
      setLife((n) => Math.max(0, n - damage));
      setCards((old) =>
        old.map((c) =>
          c.attacking ? { ...c, attacking: false, selected: false, tapped: true } : c,
        ),
      );
      setPhase("End step");
      setLog(`${damage} preview damage. This playground does not enforce Magic rules.`);
    } else {
      setCards((old) => old.map((c) => ({ ...c, tapped: false })));
      setPhase("Main phase");
      setLog("New turn. Permanents untapped.");
    }
  };
  const sceneColors = useMemo(() => colors, []);
  return (
    <main className={targetDemo ? "arena-root duel-root" : "arena-root"} style={styles}>
      {targetDemo && (
        <div style={{ position: "absolute", right: 20, bottom: 20, width: 310, zIndex: 25 }}>
          <TargetChoices
            input={{
              presentation: { title: "Untap", targets: [] },
              candidates: cards
                .filter((card) => card.side !== "hand")
                .map((card) => ({ id: card.id, kind: "card" })),
              hostile: false,
              intent: "untap",
              minTargets: 1,
              maxTargets: 1,
              chosenTargets: 0,
              cancellable: true,
            }}
            selected={targetIds}
            onSelected={(ids) => setTargetIds(ids.slice(-1))}
            name={(id) => cards.find((card) => card.id === id)?.name ?? id}
            send={(output) =>
              setLog(output.output.type === "cancel" ? "Targeting cancelled" : "Targets confirmed")
            }
          />
        </div>
      )}
      <ArenaScene
        cards={
          targetDemo
            ? cards.map((card) => ({
                ...card,
                playable: ["p1", "o1"].includes(card.id),
                selected: targetIds.includes(card.id),
              }))
            : cards
        }
        targeting={
          targetDemo
            ? { stackId: "target-demo", candidates: ["p1", "o1"], selected: targetIds }
            : undefined
        }
        combatStep={
          phase === "Combat"
            ? "combatDeclareBlockers"
            : phase === "End step"
              ? "combatDamage"
              : "main1"
        }
        colors={sceneColors}
        links={links}
        blockTargets={
          phase === "Combat"
            ? Object.fromEntries(
                cards
                  .filter((c) => c.side === "self" && c.type.includes("Creature"))
                  .map((c) => [
                    c.id,
                    cards
                      .filter((a) => a.side === "opponent" && a.type.includes("Creature"))
                      .map((a) => a.id),
                  ]),
              )
            : undefined
        }
        onCard={click}
        onHover={setHover}
        onDrop={(id, target) => {
          if (
            target &&
            phase === "Combat" &&
            cards.find((c) => c.id === id)?.side === "self" &&
            cards.find((c) => c.id === target)?.side === "opponent"
          ) {
            setLinks((old) => [
              ...old.filter((l) => l.from !== id),
              { from: id, to: target, color: colors.hostile },
            ]);
            setLog("Combat link preview. Choose Resolve combat to continue.");
          } else if (phase !== "Combat") click(id);
        }}
      />
      {targetDemo && (
        <SpellStack
          stack={[
            {
              id: "target-demo",
              sourceId: "spell-demo",
              controllerId: "player-0",
              ownerId: "player-0",
              identity: { name: "Giant Growth", setCode: "", cardNumber: "", isToken: false },
              text: "Target creature gets +3/+3 until end of turn.",
              isPermanentSpell: false,
              isCasting: true,
              isDoubleFaced: false,
              faceIndex: 0,
              targets: [],
            },
          ]}
          open={false}
          onOpen={() => {}}
          onClose={() => {}}
          onMotion={() => {}}
          onHover={() => {}}
        />
      )}
      <header className="arena-brand">
        <h1>MANABREW</h1>
        <small>THREE.JS · VISUAL PLAYGROUND</small>
      </header>
      <button
        className="arena-menu"
        onClick={() => {
          setCards(initial);
          setPhase("Main phase");
          setLife(20);
          setDrawCount(0);
          setLinks([]);
          setLog("Battlefield reset.");
        }}
      >
        Reset table
      </button>
      <div className="arena-player arena-player-opponent">
        <div className="arena-avatar">
          <span>✧</span>
          <strong>{life}</strong>
        </div>
        <div>
          <small>OPPONENT</small>
          <h3>The Verdant Court</h3>
          <small>DINOSAURS · GREEN / RED</small>
        </div>
      </div>
      <aside className="arena-status">
        <small>THE SUNKEN ARCHIVE</small>
        <h2>{phase}</h2>
        <p>{log}</p>
      </aside>
      <div className="arena-phase-strip">
        {["Main phase", "Combat", "End step"].map((name) => (
          <button
            key={name}
            data-active={phase === name}
            onClick={() => {
              setPhase(name);
              setLog(`${name} selected.`);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="arena-player arena-player-self">
        <div className="arena-avatar">
          <span>◈</span>
          <strong>20</strong>
        </div>
        <div>
          <small>YOU</small>
          <h3>The Tidecaller</h3>
          <small>{cards.filter((c) => c.side === "hand").length} CARDS IN HAND</small>
        </div>
      </div>
      <div className="arena-actions">
        <small>YOUR TURN</small>
        <strong>
          {phase === "Combat" ? `${attackers.length} attacking` : "The tide is yours"}
        </strong>
        <button onClick={next}>
          {phase === "Main phase"
            ? "Begin combat →"
            : phase === "Combat"
              ? "Resolve combat →"
              : "Next turn →"}
        </button>
        <button
          onClick={() => {
            const id = `draw${drawCount}`;
            setDrawCount((n) => n + 1);
            setCards((old) => [
              ...old,
              makeCard(
                id,
                "Storm Fleet Spy",
                "hand",
                "Creature — Human Pirate",
                "2/2",
                "Raid — Draw a card if you attacked this turn.",
              ),
            ]);
            setLog("Drew Storm Fleet Spy.");
          }}
        >
          Draw a card
        </button>
      </div>
      <CardPreview card={selected ?? undefined} onInspect={setHover} hideDetails={abilitiesOpen} />
      {abilitiesOpen && (
        <CardActionPicker
          name="Kenrith, the Returned King"
          actions={demoActions}
          onChoose={(action) => {
            setLog(
              `Ability ${demoActions.indexOf(action) + 1} selected. This is a UI example; no rules action was sent.`,
            );
            setAbilitiesOpen(false);
          }}
          onClose={() => setAbilitiesOpen(false)}
        />
      )}
      <button
        className="arena-frame-samples"
        onClick={() =>
          setCards((old) => [
            ...old.filter((c) => !c.id.startsWith("sample-")),
            ...(
              [
                ["W", "Serra Angel", "4/4"],
                ["U", "Air Elemental", "4/4"],
                ["B", "Sengir Vampire", "4/4"],
                ["R", "Shivan Dragon", "5/5"],
                ["G", "Colossal Dreadmaw", "6/6"],
                ["C", "Juggernaut", "5/3"],
              ] as const
            ).map(([frame, name, stats]) => ({
              ...makeCard(`sample-${frame}`, name, "self", "Creature", stats),
              frame,
              color: preset.gameColors[`mana.${frame}`],
            })),
          ])
        }
      >
        Compare frame colors
      </button>
      <div className="arena-footer">
        Interaction sandbox · No rules engine in this preview · Click to play / tap · Drag to
        connect combatants
      </div>
    </main>
  );
}
