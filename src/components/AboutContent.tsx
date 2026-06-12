import { cn } from "@/lib/utils";
import { OnboardingGuide } from "@/components/OnboardingGuide";
import { ScreenshotCarousel } from "@/components/ScreenshotCarousel";
import { DiscordCallout } from "@/components/DiscordCallout";

export function AboutContent({ fullBleedCarousel = false }: { fullBleedCarousel?: boolean }) {
  return (
    <div className="space-y-6">
      <div
        className={cn(fullBleedCarousel ? "relative left-1/2 w-dvw -translate-x-1/2" : "w-full")}
      >
        <ScreenshotCarousel />
      </div>
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <OnboardingGuide />
        <DiscordCallout />
      </div>
    </div>
  );
}
