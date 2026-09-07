import { useCallback, useEffect, useRef, useState } from "react";
import { createForgeEngine } from "@manabrew/forge-wasm";
import type { ForgeEngine } from "@manabrew/forge-wasm";
import type { GameViewDto, Prompt, PromptOutput } from "@manabrew/protocol";
import { isPhaseStopped } from "@/three/duelFlow";
import { duelDecks } from "@/three/duelDecks";
import type { DuelMatch } from "@/three/duelMatch";
import { AUTOPASS_DELAY_MIN_MS, AUTOPASS_DELAY_MAX_MS } from "@/components/game/game.constants";
import type { AutoPassCountdown } from "@/three/arena.types";

export function useForgeDuel() {
  const engine = useRef<ForgeEngine | null>(null);
  const generation = useRef(0);
  const pending = useRef<Prompt | null>(null);
  const [view, setView] = useState<GameViewDto | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [status, setStatus] = useState("Choose your deck to begin.");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deckIndex, setDeckIndex] = useState(0);
  const [deckName, setDeckName] = useState(duelDecks[0].name);
  const [playerColors, setPlayerColors] = useState<Record<string, string[]>>({});
  const [fullControl, setFullControl] = useState(false);
  const [stops, setStops] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoPaying, setAutoPaying] = useState(false);
  const [autoPassCountdown, setAutoPassCountdown] = useState<AutoPassCountdown | null>(null);
  const autoPaySteps = useRef(0);
  const lastMatch = useRef<DuelMatch | undefined>(undefined);
  const lastPlayerCount = useRef(2);
  useEffect(
    () => () => {
      generation.current++;
      engine.current?.dispose();
    },
    [],
  );
  const start = async (index: number, playerCount = 2, match?: DuelMatch) => {
    lastMatch.current = match;
    lastPlayerCount.current = playerCount;
    const deck = match?.deck ?? duelDecks[index];
    setDeckName(deck.name);
    const opponents =
      match?.opponents ??
      Array.from(
        { length: playerCount - 1 },
        (_, seat) => duelDecks[(index + seat + 1) % duelDecks.length],
      );
    const run = ++generation.current;
    engine.current?.dispose();
    pending.current = null;
    setDeckIndex(index);
    setPlayerColors(
      Object.fromEntries(
        Array.from({ length: playerCount }, (_, seat) => [
          `player-${seat}`,
          match?.colors[seat] ?? duelDecks[(index + seat) % duelDecks.length].colorIdentity,
        ]),
      ),
    );
    setView(null);
    setPrompt(null);
    setError("");
    setLoading(true);
    setAutoPaying(false);
    setStatus("Loading Forge and preparing the table…");
    try {
      const next = await createForgeEngine({
        onState: (state) => {
          if (run === generation.current) {
            setView(state.gameView);
            setLoading(false);
            setStatus("Forge match running");
          }
        },
        onPrompt: (request) => {
          if (run === generation.current) {
            pending.current = request;
            setPrompt(request);
            if (request.input.type !== "payManaCost") setAutoPaying(false);
            setLoading(false);
          }
        },
        onError: (failure) => {
          if (run === generation.current) {
            setError(failure.message);
            setAutoPaying(false);
            setLoading(false);
          }
        },
      });
      if (run !== generation.current) {
        next.dispose();
        return;
      }
      engine.current = next;
      await next.startGame({
        deck,
        opponentDecks: opponents,
        commanderName: deck.commanders?.[0]?.identity?.name ?? deck.commanders?.[0]?.name,
        startingLife: match?.startingLife ?? 20,
      });
    } catch (failure) {
      if (run === generation.current) {
        setLoading(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    }
  };
  const respond = useCallback((id: string | number | undefined, action: PromptOutput) => {
    if (!engine.current || String(pending.current?.promptId) !== String(id) || !pending.current)
      return;
    try {
      engine.current.respond(Number(id), action);
      pending.current = null;
      setPrompt(null);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, []);
  const concede = () => {
    engine.current?.directive({ type: "concede" });
    setStatus("Conceding at the next priority window…");
  };
  const payAutomatically = () => {
    if (pending.current?.input.type !== "payManaCost") return;
    autoPaySteps.current = 0;
    setAutoPaying(true);
  };
  useEffect(() => {
    if (!autoPaying || !prompt || prompt.input.type !== "payManaCost") return;
    const fromPool = prompt.input.canConfirmFromPool;
    const timer = window.setTimeout(() => {
      if (++autoPaySteps.current > 30) {
        setAutoPaying(false);
        setError("Auto-pay could not finish this cost. Use manual payment or cancel casting.");
        return;
      }
      respond(prompt.promptId, { type: "payManaCost", output: { type: "pay", auto: !fromPool } });
    }, 90);
    return () => window.clearTimeout(timer);
  }, [autoPaying, prompt, respond]);
  const ownMain =
    view?.stack.length === 0 &&
    view?.activePlayerId === "player-0" &&
    (view.step === "main1" || view.step === "main2");
  const meaningful =
    prompt?.input.type === "chooseAction" &&
    prompt.input.actions.some(
      (a) => a.type === "cast" || (a.type === "activateAbility" && !a.isManaAbility),
    );
  const autoPassing = Boolean(
    view &&
    !view.gameOver &&
    !fullControl &&
    !paused &&
    !error &&
    prompt?.input.type === "chooseAction" &&
    !ownMain &&
    !meaningful &&
    !isPhaseStopped(stops, view.step),
  );
  useEffect(() => {
    if (!autoPassing || !prompt) return;
    let passTimer: number;
    const timer = window.setTimeout(() => {
      const duration = Math.round(
        AUTOPASS_DELAY_MIN_MS + Math.random() * (AUTOPASS_DELAY_MAX_MS - AUTOPASS_DELAY_MIN_MS),
      );
      setAutoPassCountdown({ promptId: prompt.promptId, startedAt: performance.now(), duration });
      passTimer = window.setTimeout(
        () =>
          respond(prompt.promptId, {
            type: "chooseAction",
            output: { type: "pass", exhaustStack: false },
          }),
        duration,
      );
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(passTimer);
      setAutoPassCountdown(null);
    };
  }, [autoPassing, prompt, respond]);
  const toggleControl = useCallback(() => setFullControl((old) => !old), []);
  const toggleStop = (step: string) =>
    setStops((old) => (old.includes(step) ? old.filter((s) => s !== step) : [...old, step]));
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      )
        return;
      if (
        event.code === "Space" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !paused &&
        !autoPassing &&
        !error &&
        prompt?.input.type === "chooseAction" &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest("button,a,dialog,[role=button]")
        )
      ) {
        event.preventDefault();
        respond(prompt.promptId, {
          type: "chooseAction",
          output: { type: "pass", exhaustStack: false },
        });
        return;
      }
      if (event.ctrlKey && event.shiftKey && (event.key === "Control" || event.key === "Shift")) {
        event.preventDefault();
        toggleControl();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [toggleControl, paused, autoPassing, error, prompt, respond]);
  return {
    view,
    prompt,
    status,
    error,
    loading,
    deckIndex,
    deckName,
    playerColors,
    start,
    restart: () => start(deckIndex, lastPlayerCount.current, lastMatch.current),
    respond,
    concede,
    fullControl,
    toggleControl,
    stops,
    toggleStop,
    autoPassing,
    autoPassCountdown:
      autoPassing && autoPassCountdown?.promptId === prompt?.promptId ? autoPassCountdown : null,
    setPaused,
    autoPaying,
    payAutomatically,
  };
}
