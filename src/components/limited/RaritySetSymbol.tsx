import { useSetLookup } from "@/stores/useScryfallStore";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import { rarityToken, type UIRarity } from "@/lib/limited.utils";

interface RaritySetSymbolProps {
  rarity: UIRarity;
  setCode?: string;
  className?: string;
}

export function RaritySetSymbol({ rarity, setCode, className }: RaritySetSymbolProps) {
  const setLookup = useSetLookup();
  const theme = useTheme();
  const token = rarityToken(rarity);
  if (!token) return null;
  const color = theme.gameTheme.rarity[token];

  const svgUri = setCode ? setLookup.get(setCode.toLowerCase())?.icon_svg_uri : undefined;

  if (!svgUri) {
    return (
      <span
        className={cn("text-[10px] font-bold uppercase leading-none", className)}
        style={{ color }}
      >
        {rarity[0]?.toUpperCase()}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-block", className)}
      style={{
        backgroundColor: color,
        WebkitMaskImage: `url(${svgUri})`,
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        WebkitMaskPosition: "center",
        maskImage: `url(${svgUri})`,
        maskRepeat: "no-repeat",
        maskSize: "contain",
        maskPosition: "center",
      }}
    />
  );
}
