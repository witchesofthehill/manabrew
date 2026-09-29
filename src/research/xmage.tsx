import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AvailableActionsModal } from "@/components/prompts/AvailableActionsModal";
import { ChooseObjectModal } from "@/components/prompts/ChooseObjectModal";
import { ManualManaModal } from "@/components/prompts/ManualManaModal";
import { ChooseBooleanModal } from "@/components/prompts/ChooseBooleanModal";
import { ChooseFromSelectionModal } from "@/components/prompts/ChooseFromSelectionModal";
import { ChooseNumberModal } from "@/components/prompts/ChooseNumberModal";
import type { Prompt, PromptOutput, StateUpdate } from "@/protocol";
import "@/index.css";

type Snapshot = {
  revision: number;
  state: StateUpdate | null;
  prompt: Prompt | null;
  status: string;
};
const port = new URLSearchParams(location.search).get("port") ?? "18765";
if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  throw new Error("Invalid bridge port");
const bridge = `http://127.0.0.1:${port}`;

export function ResearchClient() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      let finished = false;
      try {
        const response = await fetch(`${bridge}/snapshot`);
        if (!response.ok) throw new Error(`Bridge returned ${response.status}`);
        const next: Snapshot = await response.json();
        if (!stopped) {
          setSnapshot((previous) => (previous?.revision === next.revision ? previous : next));
          setError("");
        }
        finished = next.status === "finished" || next.status === "stopped";
      } catch (error) {
        if (!stopped) setError(String(error));
      }
      if (!stopped && !finished) timer = setTimeout(poll, 300);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  const prompt = snapshot?.prompt;
  const view = snapshot?.state?.gameView;
  const respond = async (output: PromptOutput["output"]) => {
    if (!prompt || sending) return;
    setSending(true);
    try {
      const response = await fetch(`${bridge}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "response",
          promptId: prompt.promptId,
          action: { type: prompt.input.type, output },
        }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setSnapshot((current) =>
        current && current.prompt?.promptId === prompt.promptId
          ? { ...current, prompt: null }
          : current,
      );
    } catch (error) {
      setError(String(error));
    } finally {
      setSending(false);
    }
  };
  const choice = () => {
    if (!prompt || sending) return null;
    const input = prompt.input;
    switch (input.type) {
      case "chooseAction":
        return <AvailableActionsModal input={input} respond={respond} gameView={view} />;
      case "chooseObject":
        return <ChooseObjectModal input={input} respond={respond} gameView={view} />;
      case "payManaCost":
        return <ManualManaModal input={input} respond={respond} />;
      case "chooseBoolean":
        return <ChooseBooleanModal input={input} respond={respond} />;
      case "chooseFromSelection":
        return <ChooseFromSelectionModal input={input} respond={respond} />;
      case "chooseNumber":
        return <ChooseNumberModal input={input} respond={respond} />;
      default:
        return <p>Unsupported research prompt: {input.type}</p>;
    }
  };
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">ManaBrew · XMage research</h1>
      <p>
        {snapshot?.status ?? "Connecting"} · Turn {view?.turn ?? 0} · {view?.step ?? "pregame"}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="grid gap-6 md:grid-cols-2">
        {view?.players.map((player) => (
          <section key={player.id} className="space-y-3 rounded border p-4">
            <h2 className="font-semibold">
              {player.name} · {player.life} life
            </h2>
            {view.zones
              .filter((zone) => zone.ownerId === player.id)
              .map((zone) => (
                <div key={zone.zone}>
                  <h3>
                    {zone.zone} ({zone.count})
                  </h3>
                  <ul>
                    {zone.cards.map((card) => (
                      <li key={card.id}>
                        {card.visibility === "visible"
                          ? `${card.identity.name}${card.tapped ? " (tapped)" : ""}`
                          : "Hidden card"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        ))}
      </div>
      <section>
        <h2 className="font-semibold">Stack</h2>
        <ul>
          {view?.stack.map((item) => (
            <li key={item.id}>{item.identity.name}</li>
          ))}
        </ul>
      </section>
      <details>
        <summary>State coverage</summary>
        <p className="text-sm">Fields not projected by this research adapter:</p>
        <ul className="text-sm">
          {snapshot?.state?.unavailableFields?.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </details>
      <div key={prompt?.promptId}>{choice()}</div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider attribute="class" defaultTheme="dark">
    <TooltipProvider>
      <ResearchClient />
    </TooltipProvider>
  </ThemeProvider>,
);
