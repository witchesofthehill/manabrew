import { cn } from "@/lib/utils";
interface Props {
  className?: string;
}
export function FoilBadge({ className }: Props) {
  return (
    <span
      title={`Foil`}
      className={cn(
        "pointer-events-none absolute bottom-1 right-1 inline-flex items-center rounded-full border border-yellow-200/40 bg-black/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-yellow-200",
        className,
      )}
    >
      Foil
    </span>
  );
}
