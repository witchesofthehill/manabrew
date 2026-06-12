import { OnboardingGuide } from "@/components/OnboardingGuide";
import { ScreenshotCarousel } from "@/components/ScreenshotCarousel";
import { DiscordCallout } from "@/components/DiscordCallout";

export function AboutContent({ fullBleedCarousel = false }: { fullBleedCarousel?: boolean }) {
  return (
    <>
      {fullBleedCarousel ? (
        <div className="relative left-1/2 w-dvw -translate-x-1/2">
          <ScreenshotCarousel />
        </div>
      ) : (
        <ScreenshotCarousel className="h-52" />
      )}
      <OnboardingGuide />
      <DiscordCallout />
    </>
  );
}
