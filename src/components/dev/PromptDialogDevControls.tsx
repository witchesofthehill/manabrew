import { useState } from "react";
import { Eye } from "lucide-react";

import { Button } from "@/components/ui/button";

import { DevPromptDialogPreview } from "./DevPromptDialogPreview";
import { DEV_DIALOG_PREVIEW_GROUPS, type DevDialogPreview } from "./promptDialogPreviews";
import { DEV_SECTION, DEV_SECTION_HEADING } from "./devPanel.styles";
import { matchesDevPanelSearch, useDevPanelSearch } from "./devPanelSearchContext";

export function PromptDialogDevControls() {
  const [preview, setPreview] = useState<DevDialogPreview | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const query = useDevPanelSearch();
  const sectionMatch = matchesDevPanelSearch(
    query,
    "Dialogs and screens",
    "battlefield UI",
    "representative data",
  );
  const visibleGroups = DEV_DIALOG_PREVIEW_GROUPS.map((group) => ({
    ...group,
    options: sectionMatch
      ? group.options
      : group.options.filter((option) =>
          matchesDevPanelSearch(query, group.label, option.id, option.label, option.description),
        ),
  })).filter((group) => group.options.length > 0);

  if (visibleGroups.length === 0) return null;

  return (
    <>
      <section className={DEV_SECTION}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={DEV_SECTION_HEADING}>Dialogs and screens</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Open the real battlefield UI with representative data. Preview actions never reach the
              engine.
            </p>
          </div>
          <span className="rounded-full bg-muted px-2 py-1 font-mono text-[10px] text-muted-foreground">
            {visibleGroups.reduce((total, group) => total + group.options.length, 0)} views
          </span>
        </div>

        <div className="mt-4 space-y-4">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.options.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="outline"
                    className="h-auto min-h-14 justify-start gap-2 px-3 py-2 text-left"
                    onClick={() => {
                      setPreview(option.id);
                      setPreviewVersion((current) => current + 1);
                    }}
                  >
                    <Eye className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-foreground">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] font-normal text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {preview ? (
        <DevPromptDialogPreview
          key={previewVersion}
          preview={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}
