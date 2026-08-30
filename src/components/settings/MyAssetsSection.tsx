import { useEffect, useRef, useState } from "react";
import { ImageUp, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { AccountAsset, AssetKind } from "@/api/hubTypes";
import { formatBytes, useAssetStore, useAssetsAvailable } from "@/stores/useAssetStore";
import { useAuthStore } from "@/stores/useAuthStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { cn } from "@/lib/utils";

const KIND_LABELS: Record<AssetKind, string> = { avatar: "Avatar", playmat: "Playmat" };

export function MyAssetsSection() {
  const assets = useAssetStore((s) => s.assets);
  const usedBytes = useAssetStore((s) => s.usedBytes);
  const quotaBytes = useAssetStore((s) => s.quotaBytes);
  const loaded = useAssetStore((s) => s.loaded);
  const busy = useAssetStore((s) => s.busy);
  const available = useAssetsAvailable();
  const accountId = useAuthStore((s) => s.account?.id);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<AccountAsset | null>(null);
  const [deleting, setDeleting] = useState<AccountAsset | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!available || !accountId) return;
    let cancelled = false;
    useAssetStore
      .getState()
      .refresh()
      .then(() => {
        if (!cancelled) setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [available, accountId]);

  if (!available) return null;

  const usedPercent = quotaBytes > 0 ? Math.round(Math.min(1, usedBytes / quotaBytes) * 100) : 0;

  function beginReplace(asset: AccountAsset) {
    setEditing(asset);
    inputRef.current?.click();
  }

  async function onReplacePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    const target = editing;
    setEditing(null);
    if (!file || !target) return;
    const prefs = usePreferencesStore.getState();
    if (target.kind === "avatar" && target.id === prefs.customAvatarAssetId) {
      await useAssetStore.getState().uploadAvatar(file);
      return;
    }
    const uploaded = await useAssetStore.getState().replace(target.kind, file, target.id);
    if (uploaded && target.id === prefs.defaultPlaymatAssetId) {
      prefs.setDefaultPlaymat(uploaded.url, uploaded.assetId);
    }
  }

  async function handleDelete() {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    const prefs = usePreferencesStore.getState();
    if (target.kind === "avatar" && target.id === prefs.customAvatarAssetId) {
      await useAssetStore.getState().clearAvatar();
      return;
    }
    if (target.id === prefs.defaultPlaymatAssetId) {
      prefs.setDefaultPlaymat(undefined, undefined);
      prefs.setDefaultPlaymatSettings(undefined);
    }
    await useAssetStore.getState().remove(target.id);
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Manage uploaded assets here</h2>
      <div className="max-w-2xl space-y-4 rounded-lg border bg-card/40 p-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label>Storage</Label>
            {loaded && (
              <span className="text-xs text-muted-foreground">
                {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
              </span>
            )}
          </div>
          {loaded && (
            <div
              role="progressbar"
              aria-label="Image storage used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usedPercent}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full",
                  usedPercent >= 90 ? "bg-destructive" : "bg-primary",
                )}
                style={{ width: `${usedPercent}%` }}
              />
            </div>
          )}
        </div>

        {loadError ? (
          <div className="flex items-center gap-3">
            <p className="text-sm text-destructive">Couldn&apos;t load your images.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoadError(false);
                useAssetStore
                  .getState()
                  .refresh()
                  .catch(() => setLoadError(true));
              }}
            >
              Retry
            </Button>
          </div>
        ) : !loaded ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No images yet. Upload an avatar or a playmat and it will show up here.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {assets.map((asset) => (
              <AssetTile
                key={asset.id}
                asset={asset}
                busy={busy}
                onReplace={() => beginReplace(asset)}
                onDelete={() => setDeleting(asset)}
              />
            ))}
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onReplacePicked}
      />
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete image</DialogTitle>
            <DialogDescription>
              This permanently removes the image from your storage and frees its space. If it&apos;s
              your current avatar or a deck&apos;s playmat, that falls back to the default.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function AssetTile({
  asset,
  busy,
  onReplace,
  onDelete,
}: {
  asset: AccountAsset;
  busy: boolean;
  onReplace: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border bg-card/60 transition-colors hover:border-primary/40">
      <div className="h-[72px] w-[72px] shrink-0 bg-muted">
        <img
          src={asset.url}
          alt={`${KIND_LABELS[asset.kind]} image`}
          loading="lazy"
          className="size-full object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-1 px-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{KIND_LABELS[asset.kind]}</span>
            {asset.state === "pending" && <Badge variant="secondary">Pending</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{formatBytes(asset.byteSize)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Replace image"
          disabled={busy}
          onClick={onReplace}
        >
          <ImageUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
          title="Delete image"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
