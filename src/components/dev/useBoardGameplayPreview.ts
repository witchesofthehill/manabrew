import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { CardDto, ZoneDto } from "@/protocol/game";
import type { Prompt } from "@/protocol";
import type { PromptActionSpec } from "@/components/game/game.types";
import type { PromptOverlaySpec } from "@/pixi/prompts/prompt.types";
import type { StackSpec } from "@/pixi/stack/stack.types";
import type { ArrowSpec } from "@/pixi/types";
import type { GameThemeColors } from "@/themes/gameTheme";
import { buildDevDialogFixtures } from "./gameplayDialogFixtures";
import { previewInput } from "./gameplayPromptFixtures";
import {
  createPlaygroundTable,
  LOCAL_PLAYER_ID,
  type PlaygroundTable,
} from "./boardPlayground.data";
import {
  playgroundGameView,
  type GameplayPreviewAction,
  type GameplayPreviewModal,
} from "./boardGameplayPreview.data";

export function useBoardGameplayPreview(
  table: PlaygroundTable,
  setTable: Dispatch<SetStateAction<PlaygroundTable>>,
  zones: ZoneDto[],
  theme: GameThemeColors,
  enabled: boolean,
  onOpenControls: () => void,
) {
  const [mode, setMode] = useState<GameplayPreviewAction>(enabled ? "chooseAction" : "none");
  const [modal, setModal] = useState<Prompt | null>(null);
  const [modalHidden, setModalHidden] = useState(false);
  const [stackVisible, setStackVisible] = useState(enabled);
  const [stackCollapsed, setStackCollapsed] = useState(false);
  const [stackDialogOpen, setStackDialogOpen] = useState(false);
  const [hoveredSpell, setHoveredSpell] = useState<string | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [pendingAttacker, setPendingAttacker] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("");
  const gameView = useMemo(() => playgroundGameView(table, zones), [table, zones]);
  const fixtures = useMemo(() => buildDevDialogFixtures(gameView, [], theme)!, [gameView, theme]);
  const creatures = gameView.battlefield.filter((card) => card.types.includes("Creature"));
  const ownCreatures = creatures.filter((card) => card.controllerId === LOCAL_PLAYER_ID);
  const opponentId = table.players[1]!.id;
  const targeting = mode === "friendly" || mode === "hostile";
  const targetIds = targeting
    ? gameView.battlefield
        .filter((card) => (card.controllerId === LOCAL_PLAYER_ID) === (mode === "friendly"))
        .map((card) => card.id)
    : [];
  const targetPlayerIds = targeting
    ? table.players
        .filter((player) => (player.id === LOCAL_PLAYER_ID) === (mode === "friendly"))
        .map((player) => player.id)
    : [];
  const finish = (message: string) => {
    setOutcome(message);
    setMode("none");
    setSelectedTarget(null);
    setPendingAttacker(null);
  };
  const chooseMode = (next: GameplayPreviewAction) => {
    setMode(next);
    setOutcome("");
    setSelectedTarget(null);
    setPendingAttacker(null);
    if (["chooseAttackers", "chooseBlockers", "hostile", "friendly"].includes(next)) {
      setTable((current) => {
        const battlefield = current.cards.some((card) => card.zoneId === "battlefield")
          ? current.cards
          : [
              ...current.cards,
              ...createPlaygroundTable("sparse").cards.filter(
                (card) => card.zoneId === "battlefield",
              ),
            ];
        const attacker = battlefield.find(
          (card) =>
            card.zoneId === "battlefield" &&
            card.controllerId !== LOCAL_PLAYER_ID &&
            card.types.includes("Creature"),
        );
        const blocker = battlefield.find(
          (card) =>
            card.zoneId === "battlefield" &&
            card.controllerId === LOCAL_PLAYER_ID &&
            card.types.includes("Creature"),
        );
        return {
          ...current,
          step:
            next === "chooseAttackers"
              ? "combatDeclareAttackers"
              : next === "chooseBlockers"
                ? "combatDeclareBlockers"
                : current.step,
          cards:
            next === "chooseBlockers" && attacker
              ? battlefield.map((card) =>
                  card.id === attacker.id
                    ? {
                        ...card,
                        isAttacking: true,
                        attackingPlayerId: LOCAL_PLAYER_ID,
                        attackTargetId: LOCAL_PLAYER_ID,
                      }
                    : card,
                )
              : battlefield,
          blocks:
            next === "chooseBlockers" && attacker && blocker
              ? [{ attackerId: attacker.id, blockerId: blocker.id }]
              : current.blocks,
        };
      });
    }
    if (next === "payManaCost")
      setTable((current) => ({
        ...current,
        manaPools: {
          ...current.manaPools,
          [LOCAL_PLAYER_ID]: { ...current.manaPools[LOCAL_PLAYER_ID], G: 2, C: 2 },
        },
      }));
  };
  const declareAttackers = (ids: string[], defenderId = opponentId) =>
    setTable((current) => ({
      ...current,
      cards: current.cards.map((card) =>
        ids.includes(card.id)
          ? {
              ...card,
              isAttacking: true,
              attackingPlayerId: defenderId,
              attackTargetId: defenderId,
            }
          : card,
      ),
    }));
  const selectCard = (card: CardDto) => {
    if (targetIds.includes(card.id)) setSelectedTarget(card.id);
    if (mode === "chooseAttackers" && ownCreatures.some((candidate) => candidate.id === card.id)) {
      setTable((current) => ({
        ...current,
        cards: current.cards.map((candidate) =>
          candidate.id === card.id
            ? {
                ...candidate,
                isAttacking: !candidate.isAttacking,
                attackingPlayerId: candidate.isAttacking ? undefined : opponentId,
                attackTargetId: candidate.isAttacking ? undefined : opponentId,
              }
            : candidate,
        ),
      }));
    }
    if (mode === "chooseBlockers") {
      if (card.isAttacking && card.controllerId !== LOCAL_PLAYER_ID) setPendingAttacker(card.id);
      else if (pendingAttacker && ownCreatures.some((candidate) => candidate.id === card.id)) {
        setTable((current) => ({
          ...current,
          blocks: [
            ...current.blocks.filter((block) => block.blockerId !== card.id),
            { blockerId: card.id, attackerId: pendingAttacker },
          ],
        }));
        setPendingAttacker(null);
      }
    }
  };
  const openModal = (kind: GameplayPreviewModal) => {
    setModal({ input: previewInput(kind, fixtures) } as Prompt);
    setModalHidden(false);
    setOutcome("");
  };
  const closeModal = () => {
    setModal(null);
    setModalHidden(false);
  };
  const openStack = () => {
    setStackVisible(true);
    setStackCollapsed(false);
    setStackDialogOpen(true);
  };
  const action: PromptActionSpec = {
    promptType:
      modal?.input.type ?? (targeting ? "chooseBoardTargets" : mode === "none" ? undefined : mode),
    isWaitingForResponse: false,
    isWaitingForOthers: false,
    availableAttackerIds: ownCreatures.map((card) => card.id),
    pendingAttackers: [],
    onPassPriority: () => {
      setTable((current) => ({
        ...current,
        priorityPlayerId:
          current.priorityPlayerId === LOCAL_PLAYER_ID ? opponentId : LOCAL_PLAYER_ID,
        blocks: mode === "chooseBlockers" ? [] : current.blocks,
      }));
      finish(mode === "chooseBlockers" ? "Confirmed no blocks." : "Passed priority locally.");
    },
    onPassEndTurn: () => {
      setTable((current) => ({
        ...current,
        activePlayerId: opponentId,
        priorityPlayerId: opponentId,
        turn: current.turn + 1,
        step: "untap",
      }));
      finish("Advanced to the opponent's turn.");
    },
    multipleAttackDefenders: false,
    selectedAttackDefenderId: opponentId,
    attackAssignmentCount: ownCreatures.filter((card) => card.isAttacking).length,
    onDeclareAttackers: declareAttackers,
    onBeginAttackTargetPick: declareAttackers,
    onSubmitAttack: () =>
      finish(`Confirmed ${ownCreatures.filter((card) => card.isAttacking).length} attackers.`),
    pendingAttacker,
    pendingBlocker: null,
    attackerIds: creatures.filter((card) => card.isAttacking).map((card) => card.id),
    blockAssignments: table.blocks,
    combatPairings: [],
    onDeclareBlockers: (blocks) => {
      setTable((current) => ({ ...current, blocks }));
      finish(`Confirmed ${blocks.length} blocks.`);
    },
    damageOrderCount: 0,
    damageOrderTotal: 0,
    onConfirmDamageOrder: () => finish("Confirmed damage order."),
    onUndoDamageOrder: () => setOutcome("Damage order cleared."),
    onDefaultDamageOrder: () => setOutcome("Using battlefield order."),
    onOpenStack: openStack,
    onToggleBoardMenu: onOpenControls,
    targetCompletionLabel: selectedTarget ? "Confirm target" : "Cancel",
    targetCompletionKind: selectedTarget ? "done" : "cancel",
    onCompleteTargets: targeting
      ? () =>
          finish(
            selectedTarget
              ? `Confirmed target: ${table.cards.find((card) => card.id === selectedTarget)?.identity.name ?? table.players.find((player) => player.id === selectedTarget)?.name ?? fixtures.stack.find((spell) => spell.id === selectedTarget)?.identity.name}.`
              : "Target selection cancelled.",
          )
      : null,
    resolveCardName: (id) => table.cards.find((card) => card.id === id)?.identity.name ?? id,
    resolveCard: (id) => table.cards.find((card) => card.id === id),
    turn: table.turn,
    activePlayerName: table.players.find((player) => player.id === table.activePlayerId)!.name,
    isMyTurn: table.activePlayerId === LOCAL_PLAYER_ID,
    step: table.step,
    selfClusterMaxHeight: 300,
    payManaCostInfo:
      mode === "payManaCost"
        ? {
            cardName: "Preview spell",
            manaCost: "{2}{G}",
            manaPool: gameView.players[0]!.manaPool,
            canConfirmFromPool:
              (gameView.players[0]!.manaPool.G ?? 0) >= 1 &&
              (gameView.players[0]!.manaPool.C ?? 0) >= 2,
          }
        : null,
    onPayManaCost: () => {
      setTable((current) => ({
        ...current,
        manaPools: {
          ...current.manaPools,
          [LOCAL_PLAYER_ID]: {
            ...current.manaPools[LOCAL_PLAYER_ID],
            G: (current.manaPools[LOCAL_PLAYER_ID]?.G ?? 0) - 1,
            C: (current.manaPools[LOCAL_PLAYER_ID]?.C ?? 0) - 2,
          },
        },
      }));
      finish("Paid {2}{G} from the local mana pool.");
    },
    onAutoManaCost: () => {
      setTable((current) => ({
        ...current,
        manaPools: {
          ...current.manaPools,
          [LOCAL_PLAYER_ID]: { ...current.manaPools[LOCAL_PLAYER_ID], G: 1, C: 2 },
        },
      }));
      setOutcome("Mana prepared. Confirm payment to spend it.");
    },
    onCancelManaCost: () => finish("Payment cancelled."),
  };
  const promptSpec: PromptOverlaySpec | null =
    mode === "none" && !modal
      ? null
      : {
          currentPrompt: modal,
          localPlayerId: LOCAL_PLAYER_ID,
          gameView,
          action,
          damageOrder: null,
          gameOver: null,
          modalHidden,
          respond: (output) => {
            if (output.type === "chooseCardsDecision")
              setOutcome(
                `Selected ${output.chosenCardIds.map((id) => fixtures.cardById.get(id)?.identity.name ?? id).join(", ")}.`,
              );
            else if (output.type === "scryDecision")
              setOutcome(
                output.zoneCardIds
                  .map(
                    (ids, index) =>
                      `${["Top", "Bottom", "Graveyard"][index]}: ${ids.map((id) => fixtures.cardById.get(id)?.identity.name ?? id).join(", ") || "none"}`,
                  )
                  .join(" · "),
              );
            closeModal();
          },
          onHideModal: () => setModalHidden(true),
          onShowModal: () => setModalHidden(false),
        };
  const stackSpec: StackSpec = {
    cards: stackVisible
      ? fixtures.stack.map((spell, index) => ({
          id: spell.id,
          sourceId: spell.sourceId,
          card: fixtures.cardById.get(spell.sourceId)!,
          sourceAbilityText: spell.text,
          controllerId: spell.controllerId,
          isCasting: spell.isCasting,
          isTopOfStack: index === 0,
          seatColor:
            spell.controllerId === LOCAL_PLAYER_ID
              ? theme.playerColors.self
              : theme.playerColors.opponent1,
          isValidTarget: targeting,
          isDimmed: !!hoveredSpell && spell.id !== hoveredSpell,
        }))
      : [],
    flash: null,
    showPreStackFlash: false,
    collapsed: stackCollapsed,
  };
  const source =
    table.cards.find((card) => card.ownerId === LOCAL_PLAYER_ID && card.zoneId === "hand") ??
    ownCreatures[0];
  const arrowSpecs: ArrowSpec[] =
    targeting && source
      ? (selectedTarget
          ? [selectedTarget]
          : [...targetIds.slice(0, 1), ...targetPlayerIds.slice(0, 1)]
        ).map((id) => ({
          from: { kind: "card", id: source.id },
          to: {
            kind: table.players.some((player) => player.id === id)
              ? "player"
              : fixtures.stack.some((spell) => spell.id === id)
                ? "stack"
                : "card",
            id,
          },
          type: "casting",
          hostile: mode === "hostile",
        }))
      : [];
  return {
    mode,
    chooseMode,
    modal,
    modalHidden,
    openModal,
    closeModal,
    setModalHidden,
    stackVisible,
    setStackVisible,
    stackCollapsed,
    setStackCollapsed,
    stackDialogOpen,
    setStackDialogOpen,
    stack: fixtures.stack,
    openStack,
    setHoveredSpell,
    selectSpell: (id: string) => {
      setSelectedTarget(id);
      setStackDialogOpen(false);
      setOutcome(
        `Selected stack spell: ${fixtures.stack.find((spell) => spell.id === id)?.identity.name ?? id}.`,
      );
    },
    selectedTarget,
    setSelectedTarget,
    targetIds,
    targetPlayerIds,
    selectCard,
    outcome,
    promptSpec,
    stackSpec,
    arrowSpecs,
  };
}
