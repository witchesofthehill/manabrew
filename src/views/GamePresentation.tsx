import { lazy, Suspense } from "react";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import Game from "@/views/Game";
const SharedArenaMatch = lazy(() => import("@/views/SharedArenaMatch"));

export default function GamePresentation({ exitTo }: { exitTo?: string } = {}) {
  const view = usePreferencesStore((state) => state.battlefieldRenderer);
  return view === "3d" ? (
    <Suspense fallback={<div role="status">Loading battlefield…</div>}>
      <SharedArenaMatch />
    </Suspense>
  ) : (
    <Game exitTo={exitTo} />
  );
}
