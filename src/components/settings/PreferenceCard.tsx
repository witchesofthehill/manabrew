import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

interface PreferenceCardProps {
  title: string;
  description: string;
  value?: string;
  children: ReactNode;
}

export function PreferenceCard({ title, description, value, children }: PreferenceCardProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card/40 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        {value && <span className="text-xs font-mono text-muted-foreground">{value}</span>}
      </div>
      {children}
      <p className="mt-auto pt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
