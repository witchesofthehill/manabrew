import { Loader2 } from "lucide-react";

export function TableCreatingSplash({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[30rem] items-center justify-center px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="flex flex-col items-center gap-5 rounded-2xl border border-primary/30 bg-card/85 px-12 py-14 shadow-xl backdrop-blur-md">
        <span className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/15" />
          <span className="absolute inset-2 rounded-full bg-primary/10" />
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </span>
        <p className="font-serif text-lg font-light text-foreground/90 sm:text-xl">{label}</p>
      </div>
    </div>
  );
}
