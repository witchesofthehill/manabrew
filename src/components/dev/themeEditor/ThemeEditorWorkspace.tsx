import { useCallback, useState, type ReactNode } from "react";
import { ThemeEditorToolbar } from "./ThemeEditorToolbar";
import { ThemeTokenRail } from "./ThemeTokenRail";
import { useThemeDraft } from "./useThemeDraft";

export function ThemeEditorWorkspace({
  children,
  specimens,
}: {
  children: ReactNode;
  specimens: ReactNode;
}) {
  const editor = useThemeDraft();
  const [invalidTokens, setInvalidTokens] = useState<Set<string>>(() => new Set());
  const onValidityChange = useCallback((token: string, invalid: boolean) => {
    setInvalidTokens((current) => {
      if (current.has(token) === invalid) return current;
      const next = new Set(current);
      if (invalid) next.add(token);
      else next.delete(token);
      return next;
    });
  }, []);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden px-4 py-3 sm:px-6 lg:px-8">
      <ThemeEditorToolbar editor={editor} hasInvalidColors={invalidTokens.size > 0} />
      {editor.error && (
        <p role="alert" className="shrink-0 text-xs text-destructive">
          {editor.error}
        </p>
      )}
      {invalidTokens.size > 0 && (
        <p role="alert" className="shrink-0 text-xs text-destructive">
          Fix invalid color values before saving or exporting.
        </p>
      )}
      {editor.status && (
        <p role="status" className="shrink-0 text-xs text-muted-foreground">
          {editor.status}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden md:flex-row">
        <ThemeTokenRail editor={editor} onValidityChange={onValidityChange} />
        <div className="order-1 flex h-[52%] min-h-0 min-w-0 shrink-0 flex-col gap-2 md:order-2 md:h-auto md:flex-1">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
          <details className="max-h-[32%] shrink-0 overflow-auto overscroll-contain rounded-lg border border-border bg-card">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">
              Card specimens
            </summary>
            <div className="space-y-4 p-3 pt-1">{specimens}</div>
          </details>
        </div>
      </div>
    </div>
  );
}
