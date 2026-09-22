import { useCallback, useMemo, useState, type ComponentProps, type RefObject } from "react";

import { DialogCardBrowser } from "@/components/game/modals/DialogCardBrowser";
import { Modal } from "@/components/game/modals/Modal";
import { MobileHandControl } from "@/components/game/panels/MobileHandControl";
import { MobilePhaseStops, PHASE_CONTROLS } from "@/components/game/panels/MobilePhaseStops";
import { buildZoneBadges } from "@/components/game/panels/playerHudBadges";
import {
  PROMPT_CARD_MODAL_MAX_WIDTH_CLASS,
  PROMPT_MODAL_HEIGHT_CLASS,
} from "@/components/game/game.constants";
import { Button } from "@/components/ui/button";
import type { CardDto } from "@/protocol/game";
import type { Prompt, PromptType } from "@/protocol";
import type { BoardOverlayCanvasProps } from "@/pixi/BoardOverlayCanvas";
import { MobileBoardCanvas, type MobileBoardCanvasProps } from "@/pixi/MobileBoardCanvas";
import { MobileBoardOverlayCanvas } from "@/pixi/MobileBoardOverlayCanvas";
import type { BoardScene } from "@/pixi/board/BoardScene";
import type { PromptOverlaySpec } from "@/pixi/prompts/prompt.types";
import { GAP } from "@/pixi/constants";
import { useTheme } from "@/hooks/useTheme";

interface MobileGameSceneProps {
  battlefieldContainerRef?: RefObject<HTMLDivElement | null>;
  board: Omit<
    MobileBoardCanvasProps,
    | "onSceneChange"
    | "focusLocked"
    | "mobileHandOpen"
    | "mobileHandPeek"
    | "mobileHandControlBounds"
  > & {
    focusLocked?: boolean;
  };
  overlay: Omit<BoardOverlayCanvasProps, "scene" | "promptSpec">;
  promptSpec: PromptOverlaySpec | null;
  promptType?: PromptType;
  promptId: Prompt["promptId"] | null;
  gameOver: boolean;
  handSelectionMode: boolean;
  handCount: number;
  onDismissHoverPreview?: () => void;
  onClosePlayerSheet: () => void;
  phaseStops: Omit<ComponentProps<typeof MobilePhaseStops>, "open" | "onClose">;
}

type MobileBoardPanel = { kind: "phases" };

export function MobileGameScene({
  battlefieldContainerRef,
  board,
  overlay,
  promptSpec,
  promptType,
  promptId,
  gameOver,
  handCount,
  handSelectionMode,
  onDismissHoverPreview,
  onClosePlayerSheet,
  phaseStops,
}: MobileGameSceneProps) {
  const [scene, setScene] = useState<BoardScene | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobileBoardPanel | null>(null);
  const [mobileHandState, setMobileHandState] = useState(() => ({
    promptId,
    open: promptType === "mulligan",
  }));
  const [mobileHandPeek, setMobileHandPeek] = useState(false);
  const { gameTheme } = useTheme();
  const handActionable =
    promptType === "chooseAction" &&
    board.hand.cards.some((card) => board.hand.playableIds?.has(card.id));
  const mobilePlayerBars = useMemo(
    () =>
      board.playerBars?.map((spec) => {
        const zones = buildZoneBadges(board.zoneTiles?.[spec.playerId] ?? [], gameTheme.textMuted);
        if (zones.length === 0) return spec;
        const badges = [...spec.badges];
        const handIndex = badges.findIndex((badge) => badge.id === "hand");
        badges.splice(handIndex + 1, 0, ...zones);
        return { ...spec, badges };
      }),
    [board.playerBars, board.zoneTiles, gameTheme.textMuted],
  );
  const mobileZoneTiles = useMemo(
    () =>
      board.zoneTiles
        ? Object.fromEntries(Object.keys(board.zoneTiles).map((playerId) => [playerId, []]))
        : undefined,
    [board.zoneTiles],
  );
  const [mobileHandControlBounds, setMobileHandControlBounds] = useState<DOMRect | null>(null);
  const [revealBrowseCards, setRevealBrowseCards] = useState<CardDto[] | null>(null);
  const mobileHandOpenState =
    mobileHandState.promptId === promptId ? mobileHandState.open : promptType === "mulligan";
  const mobileHandOpen = !gameOver && (handSelectionMode || mobileHandOpenState);

  const setMobileHandOpen = useCallback(
    (open: boolean) => {
      setMobileHandState({ promptId, open });
    },
    [promptId],
  );
  const closeMobileChrome = useCallback(() => {
    setMobilePanel(null);
    setMobileHandOpen(false);
  }, [setMobileHandOpen]);
  const toggleMobileHand = useCallback(() => {
    if (handSelectionMode) return;
    onDismissHoverPreview?.();
    onClosePlayerSheet();
    setMobilePanel(null);
    setMobileHandOpen(!mobileHandOpen);
  }, [
    handSelectionMode,
    mobileHandOpen,
    onClosePlayerSheet,
    onDismissHoverPreview,
    setMobileHandOpen,
  ]);
  const openMobilePhaseStops = useCallback(() => {
    onDismissHoverPreview?.();
    onClosePlayerSheet();
    setMobileHandOpen(false);
    setMobilePanel({ kind: "phases" });
  }, [onClosePlayerSheet, onDismissHoverPreview, setMobileHandOpen]);

  const boardCallbacksBase = board.callbacks;

  const boardCallbacks = useMemo(
    () => ({
      ...boardCallbacksBase,
      onClickAnyCard: boardCallbacksBase.onClickAnyCard
        ? (...args: Parameters<NonNullable<typeof boardCallbacksBase.onClickAnyCard>>) => {
            closeMobileChrome();
            boardCallbacksBase.onClickAnyCard?.(...args);
          }
        : undefined,
      onLongPressCard: boardCallbacksBase.onLongPressCard
        ? (...args: Parameters<NonNullable<typeof boardCallbacksBase.onLongPressCard>>) => {
            closeMobileChrome();
            boardCallbacksBase.onLongPressCard?.(...args);
          }
        : undefined,
      onShowPlayerSheet: (playerId: string) => {
        onDismissHoverPreview?.();
        closeMobileChrome();
        boardCallbacksBase.onShowPlayerSheet?.(playerId);
      },
      onMobileHandOpenChange: setMobileHandOpen,
    }),
    [boardCallbacksBase, closeMobileChrome, onDismissHoverPreview, setMobileHandOpen],
  );
  const phaseStripCallbacks = useMemo(
    () => ({
      ...board.phaseStripCallbacks,
      onOpenCompactControls: openMobilePhaseStops,
    }),
    [board.phaseStripCallbacks, openMobilePhaseStops],
  );
  const localCapsuleBounds = scene?.getLocalCapsuleBounds() ?? null;
  const mobilePromptSpec = useMemo<PromptOverlaySpec | null>(() => {
    if (!promptSpec) return null;
    const armedStopReached = PHASE_CONTROLS.some(
      (phase) =>
        phaseStops.selfStops.has(phase.id) && phase.currentSteps.includes(phaseStops.currentStep),
    );
    const handOwnsChrome = mobileHandOpen && promptType !== "mulliganPutBack";
    return {
      ...promptSpec,
      action: {
        ...promptSpec.action,
        dimmed: handOwnsChrome || (promptSpec.action.dimmed ?? false),
        onBrowseRevealGrid:
          promptSpec.currentPrompt?.input.type === "revealCards"
            ? () => {
                const input = promptSpec.currentPrompt?.input;
                setRevealBrowseCards(input?.type === "revealCards" ? input.cards : []);
              }
            : undefined,
        compactPhaseControl: {
          color: phaseStops.activeColor,
          onOpen: openMobilePhaseStops,
          pulse: armedStopReached,
          anchor: localCapsuleBounds
            ? {
                x: localCapsuleBounds.x + localCapsuleBounds.width + GAP,
                y: localCapsuleBounds.y + localCapsuleBounds.height / 2,
              }
            : undefined,
        },
      },
    };
  }, [
    localCapsuleBounds,
    mobileHandOpen,
    openMobilePhaseStops,
    phaseStops.activeColor,
    phaseStops.currentStep,
    phaseStops.selfStops,
    promptSpec,
    promptType,
  ]);
  const mulliganAction = promptType === "mulligan" ? mobilePromptSpec?.action : null;

  return (
    <>
      <div ref={battlefieldContainerRef} className="absolute inset-0 z-10 overflow-hidden">
        <MobileBoardCanvas
          {...board}
          callbacks={boardCallbacks}
          focusLocked={board.focusLocked || mobileHandOpen}
          phaseStripCallbacks={phaseStripCallbacks}
          mobileHandOpen={mobileHandOpen}
          mobileHandPeek={mobileHandPeek}
          mobileHandControlBounds={mobileHandControlBounds}
          playerBars={mobilePlayerBars}
          zoneTiles={mobileZoneTiles}
          onSceneChange={setScene}
        />
        {(!mobilePanel || mobileHandOpen) && !gameOver && (
          <MobileHandControl
            count={handCount}
            open={mobileHandOpen}
            locked={handSelectionMode}
            actionable={handActionable}
            onToggle={toggleMobileHand}
            onPeekStart={() => setMobileHandPeek(true)}
            onPeekEnd={() => setMobileHandPeek(false)}
            onBoundsChange={setMobileHandControlBounds}
          />
        )}
        {promptType === "mulligan" && mobileHandOpen && mulliganAction && (
          <div className="absolute left-1/2 top-2 z-[5] flex -translate-x-1/2 items-center gap-2">
            {mulliganAction.mulliganCount ? (
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                mulligan {mulliganAction.mulliganCount}
              </span>
            ) : null}
            <Button variant="primary" size="sm" onClick={mulliganAction.onMulliganKeep}>
              KEEP
            </Button>
            <Button variant="outline" size="sm" onClick={mulliganAction.onMulliganDraw}>
              MULLIGAN
            </Button>
          </div>
        )}
        {revealBrowseCards && (
          <Modal
            onClose={() => setRevealBrowseCards(null)}
            maxWidth={PROMPT_CARD_MODAL_MAX_WIDTH_CLASS}
            className={PROMPT_MODAL_HEIGHT_CLASS}
          >
            <Modal.Header onClose={() => setRevealBrowseCards(null)}>
              <h2 className="text-base font-semibold">Revealed cards</h2>
              <p className="text-xs text-muted-foreground">
                {revealBrowseCards.length} card{revealBrowseCards.length === 1 ? "" : "s"}
              </p>
            </Modal.Header>
            <DialogCardBrowser
              items={revealBrowseCards.map((card) => ({ id: card.id, card }))}
              picker
            />
          </Modal>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 z-[9000]">
        <MobileBoardOverlayCanvas {...overlay} scene={scene} promptSpec={mobilePromptSpec} />
        <MobilePhaseStops
          {...phaseStops}
          open={!gameOver && !mobileHandOpen && mobilePanel?.kind === "phases"}
          onClose={() => setMobilePanel(null)}
        />
      </div>
    </>
  );
}
