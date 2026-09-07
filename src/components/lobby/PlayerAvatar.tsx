import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { stripUsernameTag } from "@/lib/username";

interface PlayerAvatarProps {
  username: string;
  avatarUrl?: string;
  className?: string;
  fallbackClassName?: string;
}

export function PlayerAvatar({
  username,
  avatarUrl,
  className,
  fallbackClassName,
}: PlayerAvatarProps) {
  return (
    <Avatar className={cn("h-7 w-7", className)}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt="" crossOrigin="anonymous" />}
      <AvatarFallback className={cn("text-xs", fallbackClassName)}>
        {stripUsernameTag(username).slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
