import { useCallback, useEffect, useRef, useState } from "react";
import { createForgeEngine } from "@manabrew/forge-wasm";
import type { ForgeEngine } from "@manabrew/forge-wasm";
import type { GameViewDto, Prompt, PromptOutput } from "@manabrew/protocol";
import { isPhaseStopped } from "@/three/duelFlow";
import { duelDecks } from "@/three/duelDecks";

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
  const [fullControl, setFullControl] = useState(false);
  const [stops, setStops] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [autoPaying, setAutoPaying] = useState(false);
  const autoPaySteps = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
      engine.current?.dispose();
    },
    [],
  );
  const start = async (index: number) => {
    const run = ++generation.current;
    engine.current?.dispose();
    pending.current = null;
    setDeckIndex(index);
    setView(null);
    setPrompt(null);
    setError("");
    setLoading(true);
    setAutoPaying(false);
    setStatus("Loading Forge and preparing both decks…");
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
        deck: duelDecks[index],
        opponentDecks: [duelDecks[1 - index]],
        startingLife: 20,
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
    const timer = window.setTimeout(
      () =>
        respond(prompt.promptId, {
          type: "chooseAction",
          output: { type: "pass", exhaustStack: false },
        }),
      450,
    );
    return () => window.clearTimeout(timer);
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
    start,
    respond,
    concede,
    fullControl,
    toggleControl,
    stops,
    toggleStop,
    autoPassing,
    setPaused,
    autoPaying,
    payAutomatically,
  };
}
