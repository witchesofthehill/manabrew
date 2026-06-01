import {
  Anchor,
  Bug,
  CloudLightning,
  Compass,
  Crown,
  Droplets,
  Feather,
  Flame,
  Gem,
  Heart,
  HelpCircle,
  Hourglass,
  Moon,
  Radiation,
  Shield,
  Skull,
  Snowflake,
  Sparkles,
  Star,
  Sun,
  Sword,
  Ticket,
  Trophy,
  Zap,
} from "lucide-react";

interface CompanionIconProps {
  iconKey: string | undefined | null;
  className?: string;
}

export function CompanionIcon({ iconKey, className }: CompanionIconProps) {
  switch (iconKey) {
    case "Anchor":
      return <Anchor className={className} aria-hidden />;
    case "Bug":
      return <Bug className={className} aria-hidden />;
    case "CloudLightning":
      return <CloudLightning className={className} aria-hidden />;
    case "Compass":
      return <Compass className={className} aria-hidden />;
    case "Crown":
      return <Crown className={className} aria-hidden />;
    case "Droplets":
      return <Droplets className={className} aria-hidden />;
    case "Feather":
      return <Feather className={className} aria-hidden />;
    case "Flame":
      return <Flame className={className} aria-hidden />;
    case "Gem":
      return <Gem className={className} aria-hidden />;
    case "Heart":
      return <Heart className={className} aria-hidden />;
    case "Hourglass":
      return <Hourglass className={className} aria-hidden />;
    case "Moon":
      return <Moon className={className} aria-hidden />;
    case "Radiation":
      return <Radiation className={className} aria-hidden />;
    case "Shield":
      return <Shield className={className} aria-hidden />;
    case "Skull":
      return <Skull className={className} aria-hidden />;
    case "Snowflake":
      return <Snowflake className={className} aria-hidden />;
    case "Sparkles":
      return <Sparkles className={className} aria-hidden />;
    case "Star":
      return <Star className={className} aria-hidden />;
    case "Sun":
      return <Sun className={className} aria-hidden />;
    case "Sword":
      return <Sword className={className} aria-hidden />;
    case "Ticket":
      return <Ticket className={className} aria-hidden />;
    case "Trophy":
      return <Trophy className={className} aria-hidden />;
    case "Zap":
      return <Zap className={className} aria-hidden />;
    default:
      return <HelpCircle className={className} aria-hidden />;
  }
}
