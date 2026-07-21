import { Anvil, Cpu } from "lucide-react";
import { GameIcon } from "@/components/game/GameIcon";
import type { EngineKind } from "@/types/server";

interface EngineMarkProps {
  engine: EngineKind;
  className?: string;
}

export function EngineMark({ engine, className }: EngineMarkProps) {
  if (engine === "Forge") return <Anvil aria-hidden="true" className={className} />;
  if (engine === "Ironsmith")
    return <GameIcon aria-hidden="true" name="anvil" className={className} />;
  return <Cpu aria-hidden="true" className={className} />;
}
