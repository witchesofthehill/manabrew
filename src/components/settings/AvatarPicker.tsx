import { useRef } from "react";
import { toast } from "sonner";
import { Camera, CircleUserRound, X } from "lucide-react";
import { AVATAR_IMAGE_BUDGET, ImageTooLargeError, normalizeToWebp } from "@/lib/imageEncode";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function AvatarPicker() {
  const customAvatar = usePreferencesStore((s) => s.customAvatar);
  const setCustomAvatar = usePreferencesStore((s) => s.setCustomAvatar);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setCustomAvatar(await normalizeToWebp(file, AVATAR_IMAGE_BUDGET));
    } catch (err) {
      toast.error(
        err instanceof ImageTooLargeError ? err.message : "Couldn't use that image as an avatar",
      );
    }
  }

  return (
    <div className="group relative self-start sm:self-center">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={customAvatar ? "Replace avatar" : "Upload avatar"}
        className="relative flex size-20 shrink-0 items-center justify-center rounded-full border bg-muted motion-safe:transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {customAvatar ? (
          <img
            src={customAvatar}
            alt="Your avatar"
            className="size-full rounded-full object-cover"
          />
        ) : (
          <CircleUserRound className="h-8 w-8 text-muted-foreground" />
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors group-hover:text-foreground">
          <Camera className="h-3 w-3" />
        </span>
      </button>
      {customAvatar && (
        <button
          type="button"
          title="Remove avatar"
          onClick={() => setCustomAvatar(undefined)}
          className="absolute -top-0.5 -right-0.5 flex size-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm motion-safe:transition-opacity opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring before:absolute before:-inset-2.5 before:content-['']"
        >
          <X className="h-3 w-3" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void onPick(e)}
      />
    </div>
  );
}
