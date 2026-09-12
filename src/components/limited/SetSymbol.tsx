import { useSetLookup } from "@/stores/useScryfallStore";
import { cn } from "@/lib/utils";
import { useSvgMaskUrl } from "@/hooks/useSvgMaskUrl";

interface SetSymbolProps {
  setCode: string;
  className?: string;
  color?: string;
}

export function SetSymbol({ setCode, className, color }: SetSymbolProps) {
  const setLookup = useSetLookup();
  const svgUri = setCode ? setLookup.get(setCode.toLowerCase())?.icon_svg_uri : undefined;
  const maskUrl = useSvgMaskUrl(svgUri);

  if (!maskUrl) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center font-mono text-[10px] font-bold uppercase",
          className,
        )}
      >
        {setCode.slice(0, 3)}
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0", className)}
      style={{
        backgroundColor: color ?? "currentColor",
        WebkitMaskImage: `url(${maskUrl})`,
        WebkitMaskRepeat: "no-repeat",
        WebkitMaskSize: "contain",
        WebkitMaskPosition: "center",
        maskImage: `url(${maskUrl})`,
        maskRepeat: "no-repeat",
        maskSize: "contain",
        maskPosition: "center",
      }}
    />
  );
}
