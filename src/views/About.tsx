import { AboutContent } from "@/components/AboutContent";
import { BreweryBackdrop } from "@/components/BreweryBackdrop";
import { VersionInfo } from "@/components/VersionInfo";

export default function About() {
  return (
    <div className="relative h-full overflow-hidden bg-background">
      <BreweryBackdrop />
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl space-y-8 px-6 py-10 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
          <header className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">AboutManabrew</h1>
            <p className="mx-auto max-w-xl text-sm text-muted-foreground">
              A fan-made, non-commercial client for Magic: The Gathering — free and open source.
            </p>
          </header>
          <AboutContent />
          <VersionInfo />
        </div>
      </div>
    </div>
  );
}
