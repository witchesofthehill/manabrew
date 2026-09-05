import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import { PHASES } from "@/components/game/game.constants";
import {
  PLAYGROUND_SCENARIOS,
  type PlaygroundScenarioId,
  type PlaygroundTable,
} from "@/components/dev/boardPlayground.data";
import type { StepKind } from "@/protocol/game";
import { MANA_LETTERS, type ManaLetter } from "@/themes/gameTheme";

interface BoardPlaygroundControlsProps {
  table: PlaygroundTable;
  setTable: Dispatch<SetStateAction<PlaygroundTable>>;
  loadScenario: (scenario: PlaygroundScenarioId) => void;
  overview: boolean;
  setOverview: (overview: boolean) => void;
  focusedPlayerId: string;
  setFocusedPlayerId: (id: string) => void;
}

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground";

export function BoardPlaygroundControls({
  table,
  setTable,
  loadScenario,
  overview,
  setOverview,
  focusedPlayerId,
  setFocusedPlayerId,
}: BoardPlaygroundControlsProps) {
  const changeMana = (playerId: string, letter: ManaLetter, delta: number) =>
    setTable((current) => ({
      ...current,
      manaPools: {
        ...current.manaPools,
        [playerId]: {
          ...current.manaPools[playerId],
          [letter]: Math.max(0, (current.manaPools[playerId]?.[letter] ?? 0) + delta),
        },
      },
    }));
  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Review scenario
          <select
            className={SELECT_CLASS}
            value={table.scenario}
            onChange={(event) => loadScenario(event.target.value as PlaygroundScenarioId)}
          >
            {PLAYGROUND_SCENARIOS.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.label}
              </option>
            ))}
          </select>
        </label>
        <Button variant="outline" size="sm" onClick={() => loadScenario(table.scenario)}>
          Reset scenario
        </Button>
        <Button
          variant={overview ? "default" : "outline"}
          size="sm"
          aria-pressed={overview}
          onClick={() => setOverview(!overview)}
        >
          {overview ? "Overview" : "Focused table"}
        </Button>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Focus seat
          <select
            className={SELECT_CLASS}
            value={focusedPlayerId}
            onChange={(event) => setFocusedPlayerId(event.target.value)}
          >
            {table.players.slice(1).map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Turn {table.turn}
          <select
            className={SELECT_CLASS}
            value={table.activePlayerId}
            onChange={(event) =>
              setTable((current) => ({ ...current, activePlayerId: event.target.value }))
            }
          >
            {table.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Priority
          <select
            className={SELECT_CLASS}
            value={table.priorityPlayerId}
            onChange={(event) =>
              setTable((current) => ({ ...current, priorityPlayerId: event.target.value }))
            }
          >
            {table.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          Step
          <select
            className={SELECT_CLASS}
            value={table.step}
            onChange={(event) =>
              setTable((current) => ({ ...current, step: event.target.value as StepKind }))
            }
          >
            {PHASES.map((phase) => (
              <option key={phase.id} value={phase.id}>
                {phase.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setTable((current) => {
              const next =
                current.players[
                  (current.players.findIndex((player) => player.id === current.activePlayerId) +
                    1) %
                    current.players.length
                ]!;
              return {
                ...current,
                activePlayerId: next.id,
                priorityPlayerId: next.id,
                turn: current.turn + 1,
                step: "untap",
                blocks: [],
                cards: current.cards.map((card) => ({
                  ...card,
                  isAttacking: false,
                  attackingPlayerId: undefined,
                  attackTargetId: undefined,
                  tapped: card.controllerId === next.id ? false : card.tapped,
                })),
              };
            })
          }
        >
          Next turn
        </Button>
        {table.players.map((player) => (
          <label key={player.id} className="grid gap-1 text-xs text-muted-foreground">
            {player.name.split(" · ")[0]} life
            <input
              className="h-9 w-20 rounded-md border border-input bg-background px-2 text-sm text-foreground"
              type="number"
              value={table.life[player.id]}
              onChange={(event) => {
                const life = event.target.valueAsNumber;
                if (Number.isFinite(life))
                  setTable((current) => ({
                    ...current,
                    life: { ...current.life, [player.id]: life },
                  }));
              }}
            />
          </label>
        ))}
      </div>
      <details open={table.scenario === "player-panels"}>
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Floating mana
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Add, spend, or clear mana without changing turn, priority, or focus.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {table.players.map((player) => (
            <fieldset key={player.id} className="min-w-0 rounded-md border border-border p-2">
              <legend className="px-1 text-xs font-medium text-foreground">{player.name}</legend>
              <div className="grid grid-cols-6 gap-1">
                {MANA_LETTERS.map((letter) => {
                  const amount = table.manaPools[player.id]?.[letter] ?? 0;
                  return (
                    <div key={letter} className="grid justify-items-center gap-1">
                      <span className="text-xs font-medium text-muted-foreground">{letter}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        aria-label={`Add ${letter} mana to ${player.name}`}
                        onClick={() => changeMana(player.id, letter, 1)}
                      >
                        +
                      </Button>
                      <output
                        className="text-sm tabular-nums text-foreground"
                        aria-label={`${player.name} ${letter} mana`}
                      >
                        {amount}
                      </output>
                      <Button
                        size="icon"
                        variant="outline"
                        className="h-8 w-8"
                        aria-label={`Spend ${letter} mana from ${player.name}`}
                        disabled={amount === 0}
                        onClick={() => changeMana(player.id, letter, -1)}
                      >
                        -
                      </Button>
                    </div>
                  );
                })}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2"
                onClick={() =>
                  setTable((current) => ({
                    ...current,
                    manaPools: { ...current.manaPools, [player.id]: {} },
                  }))
                }
              >
                Clear pool
              </Button>
            </fieldset>
          ))}
        </div>
      </details>
    </div>
  );
}
