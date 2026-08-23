import { useRef } from "react";
import { Camera, CircleUserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAssetsAvailable, useAssetStore } from "@/stores/useAssetStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function AvatarPicker() {
  const avatarSrc = usePreferencesStore((s) => s.customAvatarUrl);
  const uploadAvatar = useAssetStore((s) => s.uploadAvatar);
  const clearAvatar = useAssetStore((s) => s.clearAvatar);
  const busy = useAssetStore((s) => s.busy);
  const available = useAssetsAvailable();
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void uploadAvatar(file);
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        disabled={busy || !available}
        onClick={() => inputRef.current?.click()}
        title={avatarSrc ? "Replace avatar" : "Upload avatar"}
        className="group relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted motion-safe:transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {avatarSrc ? (
          <img src={avatarSrc} alt="Your avatar" className="size-full object-cover" />
        ) : (
          <CircleUserRound className="h-8 w-8 text-muted-foreground" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-overlay/60 text-white opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera className="h-5 w-5" />
        </span>
      </button>
      <div className="flex flex-col items-start gap-2">
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !available}
            onClick={() => inputRef.current?.click()}
          >
            {avatarSrc ? "Replace" : "Upload"}
          </Button>
          {avatarSrc && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void clearAvatar()}>
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Shown on your player panel and to opponents when a game starts.
        </p>
      </div>
    </div>
  );
}
