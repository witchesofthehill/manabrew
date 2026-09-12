import { useCallback, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeEditorToolbar } from "./ThemeEditorToolbar";
import { ThemeTokenRail } from "./ThemeTokenRail";
import { useThemeDraft } from "./useThemeDraft";

function AppElementPreview() {
  return (
    <section
      className="shrink-0 overflow-x-auto overscroll-x-contain rounded-lg border border-border bg-background"
      aria-labelledby="app-element-preview-title"
    >
      <div className="flex min-w-max items-start gap-6 p-3">
        <header className="w-32 shrink-0 space-y-1 pt-1">
          <h2 id="app-element-preview-title" className="text-sm font-semibold">
            App elements
          </h2>
          <p className="text-[11px] leading-snug text-muted-foreground">Live theme preview</p>
        </header>

        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Buttons
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm">
              Primary
            </Button>
            <Button type="button" size="sm" variant="secondary">
              Secondary
            </Button>
            <Button type="button" size="sm" variant="outline">
              Outline
            </Button>
            <Button type="button" size="sm" variant="destructive">
              Delete
            </Button>
            <Button type="button" size="sm" disabled>
              Disabled
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="app-element-preview-input">Input</Label>
          <Input id="app-element-preview-input" className="w-48" placeholder="Search cards…" />
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Selection
          </div>
          <div className="flex items-center gap-4">
            <Label className="flex items-center gap-2">
              <Checkbox defaultChecked />
              Checked
            </Label>
            <Label className="flex items-center gap-2">
              <Checkbox />
              Unchecked
            </Label>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Badges
          </div>
          <div className="flex items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="destructive">Warning</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
        </div>

        <Card className="w-52 shrink-0 shadow-sm">
          <CardContent className="space-y-1 p-3">
            <div className="text-sm font-semibold">Card surface</div>
            <p className="text-xs text-muted-foreground">Foreground and muted copy</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

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
      <AppElementPreview />
    </div>
  );
}
