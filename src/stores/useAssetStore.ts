import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { toast } from "sonner";
import {
  assetQuotaFromError,
  deleteAsset,
  fetchAccountAssets,
  setAccountAvatar,
  uploadAsset,
} from "@/api/assets";
import type { AccountAsset, AssetKind } from "@/api/hubTypes";
import {
  AVATAR_IMAGE_BUDGET,
  ImageTooLargeError,
  normalizeToWebp,
  PLAYMAT_IMAGE_BUDGET,
} from "@/lib/imageEncode";
import { useAuthStore } from "@/stores/useAuthStore";
import { useHubStore } from "@/stores/useHubStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export interface AssetRef {
  assetId: string;
  url: string;
}

const BUDGETS = { avatar: AVATAR_IMAGE_BUDGET, playmat: PLAYMAT_IMAGE_BUDGET } as const;

interface AssetState {
  assets: AccountAsset[];
  usedBytes: number;
  quotaBytes: number;
  loaded: boolean;
  busy: boolean;
  refresh: () => Promise<void>;
  /** Uploads `source` and then discards `replaces`, so swapping a cosmetic can
   *  never strand the previous object owned and counting against the quota.
   *  New first: a failed upload leaves the old image intact. */
  replace: (
    kind: AssetKind,
    source: Blob,
    replaces: string | undefined,
  ) => Promise<AssetRef | undefined>;
  remove: (assetId: string | undefined) => Promise<void>;
  /** The account avatar has a server-side link as well as a local one, so the
   *  whole swap — upload, link, store, discard the old — lives here rather than
   *  in the picker. */
  uploadAvatar: (source: Blob) => Promise<void>;
  clearAvatar: () => Promise<void>;
}

export const useAssetStore = create<AssetState>()(
  devtools(
    (set, get) => ({
      assets: [],
      usedBytes: 0,
      quotaBytes: 0,
      loaded: false,
      busy: false,

      refresh: async () => {
        const list = await fetchAccountAssets();
        set({
          assets: list.assets,
          usedBytes: list.usedBytes,
          quotaBytes: list.quotaBytes,
          loaded: true,
        });
      },

      replace: async (kind, source, replaces) => {
        const limits = useHubStore.getState().capabilities?.assets;
        if (!limits) {
          toast.error("Image uploads aren't available on this server");
          return undefined;
        }
        set({ busy: true });
        try {
          const maxBytes = kind === "avatar" ? limits.maxAvatarBytes : limits.maxPlaymatBytes;
          const encoded = await normalizeToWebp(source, { ...BUDGETS[kind], maxBytes });
          const uploaded = await uploadAsset(kind, encoded);
          await discard(replaces);
          await get().refresh();
          return uploaded;
        } catch (error) {
          reportUploadFailure(error);
          return undefined;
        } finally {
          set({ busy: false });
        }
      },

      uploadAvatar: async (source) => {
        const previous = usePreferencesStore.getState().customAvatarAssetId;
        const uploaded = await get().replace("avatar", source, previous);
        if (!uploaded) return;
        await setAccountAvatar(uploaded.assetId);
        usePreferencesStore.getState().setCustomAvatar(uploaded.url, uploaded.assetId);
      },

      clearAvatar: async () => {
        const previous = usePreferencesStore.getState().customAvatarAssetId;
        await setAccountAvatar(undefined);
        usePreferencesStore.getState().setCustomAvatar(undefined, undefined);
        await get().remove(previous);
      },

      remove: async (assetId) => {
        if (!assetId) return;
        set({ busy: true });
        try {
          await discard(assetId);
          await get().refresh();
        } finally {
          set({ busy: false });
        }
      },
    }),
    { name: "assets" },
  ),
);

export function useAssetsAvailable(): boolean {
  const configured = useHubStore((s) => !!s.capabilities?.assets);
  const signedIn = useAuthStore((s) => s.status === "signedIn");
  return configured && signedIn;
}

async function discard(assetId: string | undefined): Promise<void> {
  if (!assetId) return;
  try {
    await deleteAsset(assetId);
  } catch {
    toast.error("Couldn't remove the previous image from your storage");
  }
}

function reportUploadFailure(error: unknown): void {
  const quota = assetQuotaFromError(error);
  if (quota) {
    toast.error(
      `You've used ${formatBytes(quota.usedBytes)} of your ${formatBytes(quota.quotaBytes)} of image storage. Remove an image to free space.`,
    );
  } else if (error instanceof ImageTooLargeError) {
    toast.error(error.message);
  } else {
    toast.error("Couldn't upload that image");
  }
}

function formatBytes(bytes: number): string {
  const megabytes = bytes / (1024 * 1024);
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${Math.round(megabytes)} MB`;
}
