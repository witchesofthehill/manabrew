import { OnboardingGuide } from "@/components/OnboardingGuide";
import { DiscordCallout } from "@/components/DiscordCallout";

export function AboutContent() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <OnboardingGuide />
      <DiscordCallout />
    </div>
  );
}
