import logoUrl from "@/assets/manaBrew.png";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
export function ManaBrewLogo({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <img
      src={logoUrl}
      alt={i18n._(msg`Manabrew`)}
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
