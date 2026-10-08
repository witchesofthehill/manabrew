import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchSetPool } from "@/api/limitedEdition";
import { useLimitedStore } from "@/stores/useLimitedStore";
import type { DraftCard } from "@/types/limited";
import type { RoomPlayerInfo } from "@/types/server";
import type { LimitedSetupMode, LimitedSetupSource } from "./limitedSetup.types";

interface PendingDraftStart {
  format: "Booster Draft" | "Winston Draft" | "Chaos Draft";
  seatCount: number;
  start: () => Promise<void>;
}

export function useLimitedSetup(selectedCode: string, selectedVariant: string) {
  const navigate = useNavigate();
  const startSealed = useLimitedStore((state) => state.startSealed);
  const startDraft = useLimitedStore((state) => state.startBoosterDraft);
  const startWinston = useLimitedStore((state) => state.startWinston);
  const importCube = useLimitedStore((state) => state.importCubeFromCubeCobra);
  const cube = useLimitedStore((state) => state.lastImportedCube);
  const isStarting = useLimitedStore((state) => state.isStarting);
  const lastError = useLimitedStore((state) => state.lastError);
  const fetchTemplates = useLimitedStore((state) => state.fetchSealedTemplates);
  const fetchThemes = useLimitedStore((state) => state.fetchChaosThemes);
  const [mode, setMode] = useState<LimitedSetupMode>("sealed");
  const [source, setSource] = useState<LimitedSetupSource>("set");
  const [numBoosters, setNumBoosters] = useState(6);
  const [podSize, setPodSize] = useState(8);
  const [winstonPacks, setWinstonPacks] = useState(6);
  const [seed, setSeed] = useState("");
  const [picksPerPass, setPicksPerPass] = useState(1);
  const [pickSeconds, setPickSeconds] = useState<number | undefined>();
  const [cubeInput, setCubeInput] = useState("");
  const [fetchingPool, setFetchingPool] = useState(false);
  const [pendingDraftStart, setPendingDraftStart] = useState<PendingDraftStart | null>(null);
  const draftStartConfirmed = useRef(false);
  useEffect(() => {
    void fetchTemplates();
    void fetchThemes();
  }, [fetchTemplates, fetchThemes]);
  const parsedSeed = Number(seed.trim());
  const seedOpt =
    seed.trim() && Number.isFinite(parsedSeed) && parsedSeed >= 0
      ? Math.floor(parsedSeed)
      : undefined;
  const busy = isStarting || fetchingPool;
  const startBlocked = busy || (source === "set" ? !selectedCode : !cube?.pool?.length);
  const chooseDraftTable = (pending: PendingDraftStart) => {
    draftStartConfirmed.current = false;
    setPendingDraftStart(pending);
  };
  const confirmDraftTable = () => {
    if (!pendingDraftStart || draftStartConfirmed.current) return;
    draftStartConfirmed.current = true;
    setPendingDraftStart(null);
    void pendingDraftStart.start();
  };
  const startCurrentSession = async () => {
    try {
      const custom = source === "custom";
      setFetchingPool(!custom);
      const pool = custom ? cube!.pool! : await fetchSetPool(selectedCode);
      setFetchingPool(false);
      const variant = custom ? undefined : selectedVariant || undefined;
      if (mode === "sealed") {
        const session = await startSealed({
          poolType: custom ? "Custom" : "Full",
          numBoosters,
          pool,
          variant,
          seed: seedOpt,
          ...(custom ? { singleton: cube!.singleton } : {}),
        });
        navigate(`/sealed/${session.sessionId}`);
      } else if (mode === "draft") {
        const session = await startDraft({
          podSize,
          rounds: 3,
          pool,
          variant,
          seed: seedOpt,
          picksPerPass,
          pickSeconds,
          ...(custom ? { customPool: true } : {}),
        });
        navigate(`/draft/${session.sessionId}`);
      } else {
        const session = await startWinston({
          poolPacks: winstonPacks,
          pool,
          variant,
          seed: seedOpt,
          ...(custom ? { customPool: true } : {}),
        });
        navigate(`/winston/${session.sessionId}`);
      }
    } catch (error) {
      useLimitedStore.setState({ lastError: String(error) });
    } finally {
      setFetchingPool(false);
    }
  };
  const start = () => {
    if (startBlocked) return;
    if (mode === "sealed") void startCurrentSession();
    else
      chooseDraftTable({
        format: mode === "draft" ? "Booster Draft" : "Winston Draft",
        seatCount: mode === "draft" ? podSize : 2,
        start: startCurrentSession,
      });
  };
  const startChaos = (setCodes: string[]) => {
    chooseDraftTable({
      format: "Chaos Draft",
      seatCount: podSize,
      start: async () => {
        try {
          setFetchingPool(true);
          const pool: DraftCard[] = [];
          for (const code of setCodes) pool.push(...(await fetchSetPool(code)));
          setFetchingPool(false);
          const session = await startDraft({
            podSize,
            rounds: 3,
            pool,
            seed: seedOpt,
            picksPerPass,
            pickSeconds,
          });
          navigate(`/draft/${session.sessionId}`);
        } catch (error) {
          useLimitedStore.setState({ lastError: String(error) });
        } finally {
          setFetchingPool(false);
        }
      },
    });
  };
  const onImport = async () => {
    if (!cubeInput.trim()) return;
    try {
      const result = await importCube(cubeInput.trim());
      setNumBoosters(Math.max(3, Math.min(12, result.numPacks)));
    } catch (error) {
      useLimitedStore.setState({ lastError: String(error) });
    }
  };
  const onLoadFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as
        | DraftCard[]
        | { name?: string; pool?: DraftCard[] };
      const pool = Array.isArray(parsed) ? parsed : parsed.pool;
      if (!Array.isArray(pool) || pool.length === 0)
        throw new Error("Expected a non-empty pool array");
      const name =
        (!Array.isArray(parsed) && parsed.name) || file.name.replace(/\.(json|draft)$/i, "");
      useLimitedStore.setState({
        lastImportedCube: {
          cubeId: `local:${name}`,
          name,
          cardCount: pool.length,
          numPacks: 3,
          singleton: false,
          pool,
          playableCardCount: pool.length,
          rejectedCardCount: 0,
        },
        lastError: null,
      });
    } catch (error) {
      useLimitedStore.setState({ lastError: `Failed to load pool: ${String(error)}` });
    }
  };
  const draftSeats: RoomPlayerInfo[] = Array.from(
    { length: pendingDraftStart?.seatCount ?? 2 },
    (_, index) => ({
      username: index === 0 ? "You" : `AI ${index}`,
      is_bot: index > 0,
      ready: true,
      connected: true,
    }),
  );
  return {
    mode,
    setMode,
    source,
    setSource,
    numBoosters,
    setNumBoosters,
    podSize,
    setPodSize,
    winstonPacks,
    setWinstonPacks,
    seed,
    setSeed,
    picksPerPass,
    setPicksPerPass,
    pickSeconds,
    setPickSeconds,
    cubeInput,
    setCubeInput,
    cube,
    busy,
    fetchingPool,
    isStarting,
    startBlocked,
    lastError,
    start,
    startChaos,
    onImport,
    onLoadFile,
    pendingDraftStart,
    cancelDraftTable: () => setPendingDraftStart(null),
    confirmDraftTable,
    draftSeats,
  };
}
