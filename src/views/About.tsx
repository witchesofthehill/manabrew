import { AboutContent } from "@/components/AboutContent";
import { VersionInfo } from "@/components/VersionInfo";

export default function About() {
  return (
    <div className="relative h-full overflow-hidden">
      <div className="relative z-10 h-full overflow-y-auto">
        <div className="w-full space-y-8 px-4 py-10 pb-10 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="mx-auto max-w-xl text-sm text-muted-foreground">
              A fan-made, non-commercial client for Magic: The Gathering — free and open source.
            </p>
          </div>
          <AboutContent />
          <VersionInfo />
        </div>
      </div>
    </div>
  );
}
