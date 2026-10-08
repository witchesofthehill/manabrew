import { Settings } from "lucide-react";
import { LimitedDisplaySettings } from "@/components/limited/LimitedDisplaySettings";
import { useLimitedBuildStore } from "@/components/limited/useLimitedBuildStore";
import { TableSetupTableCard } from "@/components/lobby/TableSetupTableCard";
import {
  IN_GAME_CARD_PREVIEW_SIZE_OPTIONS,
  IN_GAME_CARD_PREVIEW_STYLE_OPTIONS,
} from "@/components/game/cardPreviewStyles";
import { AppSelect, AppSelectOption } from "@/components/ui/AppSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import type { InGameCardPreviewSize, InGameCardPreviewStyle } from "@/stores/usePreferencesStore";

interface LimitedSettingsButtonProps {
  sessionKey: string;
  quickPick?: boolean;
  sharedTable?: boolean;
}

export function LimitedSettingsButton({
  sessionKey,
  quickPick = false,
  sharedTable = false,
}: LimitedSettingsButtonProps) {
  const previewStyle = usePreferencesStore((state) => state.inGameCardPreviewStyle);
  const previewSize = usePreferencesStore((state) => state.inGameCardPreviewSize);
  const background = usePreferencesStore((state) => state.boardBackgroundId);
  const animations = usePreferencesStore((state) => state.inGameAnimations);
  const quickPickEnabled = useLimitedBuildStore((state) => state.quickPick);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Limited settings" title="Limited settings">
          <Settings className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg [&>button]:right-2 [&>button]:top-2 [&>button]:flex [&>button]:h-11 [&>button]:w-11 [&>button]:items-center [&>button]:justify-center">
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>Limited settings</DialogTitle>
          <DialogDescription>
            Changes apply immediately and are saved. Draft clocks keep running.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto">
          <LimitedDisplaySettings sessionKey={sessionKey} />
          <section className="space-y-4 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Card inspection</h3>
            <fieldset className="space-y-2">
              <legend className="text-sm">Preview view</legend>
              <AppSelect
                aria-label="Preview view"
                value={previewStyle}
                onValueChange={(value) =>
                  usePreferencesStore
                    .getState()
                    .setInGameCardPreviewStyle(value as InGameCardPreviewStyle)
                }
                className="w-full"
              >
                {IN_GAME_CARD_PREVIEW_STYLE_OPTIONS.map((option) => (
                  <AppSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </AppSelectOption>
                ))}
              </AppSelect>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm">Preview size</legend>
              <AppSelect
                aria-label="Preview size"
                value={previewSize}
                onValueChange={(value) =>
                  usePreferencesStore
                    .getState()
                    .setInGameCardPreviewSize(value as InGameCardPreviewSize)
                }
                className="w-full"
              >
                {IN_GAME_CARD_PREVIEW_SIZE_OPTIONS.map((option) => (
                  <AppSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </AppSelectOption>
                ))}
              </AppSelect>
            </fieldset>
          </section>
          {quickPick && (
            <section className="space-y-2 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">Picking</h3>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={quickPickEnabled}
                  onChange={(event) =>
                    useLimitedBuildStore.getState().setQuickPick(event.target.checked)
                  }
                  className="h-4 w-4 accent-primary"
                />
                Quick pick
              </label>
              <p className="text-xs text-muted-foreground">
                Select a card to pick it straight into your pool.
              </p>
            </section>
          )}
          <section className="space-y-4 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">Table appearance</h3>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={animations}
                onChange={(event) =>
                  usePreferencesStore.getState().setInGameAnimations(event.target.checked)
                }
                className="h-4 w-4 accent-primary"
              />
              Decorative animations
            </label>
            <p className="text-xs text-muted-foreground">
              System reduced-motion preferences still apply.
            </p>
            <fieldset className="space-y-2">
              <legend className="text-sm">Table background</legend>
              {sharedTable ? (
                <p className="text-xs text-muted-foreground">
                  The room controls this table's background.
                </p>
              ) : (
                <TableSetupTableCard
                  background={background}
                  onBackgroundChange={(value) =>
                    usePreferencesStore.getState().setBoardBackgroundId(value)
                  }
                  columns={3}
                  className=""
                />
              )}
            </fieldset>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
