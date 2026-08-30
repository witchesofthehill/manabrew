import { useRef } from "react";
import { Camera, CircleUserRound, X } from "lucide-react";
import { useAssetsAvailable, useAssetStore } from "@/stores/useAssetStore";
import { useAuthStore } from "@/stores/useAuthStore";

export function AvatarPicker() {
  const avatarSrc = useAuthStore((s) => s.account?.avatarUrl);
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
    <div className="group relative self-start sm:self-center">
      <button
        type="button"
        disabled={busy || !available}
        onClick={() => inputRef.current?.click()}
        title={avatarSrc ? "Replace avatar" : "Upload avatar"}
        className="relative flex size-20 shrink-0 items-center justify-center rounded-full border bg-muted motion-safe:transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {avatarSrc ? (
          <img src={avatarSrc} alt="Your avatar" className="size-full rounded-full object-cover" />
        ) : (
          <CircleUserRound className="h-8 w-8 text-muted-foreground" />
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors group-hover:text-foreground">
          <Camera className="h-3 w-3" />
        </span>
      </button>
      {avatarSrc && (
        <button
          type="button"
          title="Remove avatar"
          disabled={busy}
          onClick={() => void clearAvatar()}
          className="absolute -top-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm motion-safe:transition-opacity opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring before:absolute before:-inset-2.5 before:content-['']"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
    </div>
  );
}
