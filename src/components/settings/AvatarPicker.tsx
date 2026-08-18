import { useRef } from "react";
import { toast } from "sonner";
import { Camera, CircleUserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={customAvatar ? "Replace avatar" : "Upload avatar"}
        className="group relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted motion-safe:transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {customAvatar ? (
          <img src={customAvatar} alt="Your avatar" className="size-full object-cover" />
        ) : (
          <CircleUserRound className="h-8 w-8 text-muted-foreground" />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-overlay/60 text-white opacity-0 motion-safe:transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera className="h-5 w-5" />
        </span>
      </button>
      <div className="flex flex-col items-start gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPick(e)}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            {customAvatar ? "Replace" : "Upload"}
          </Button>
          {customAvatar && (
            <Button variant="ghost" size="sm" onClick={() => setCustomAvatar(undefined)}>
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
