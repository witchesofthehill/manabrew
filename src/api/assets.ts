import { HubRequestError, hubJson, hubRequest } from "@/api/hub";
import type {
  AccountAssetList,
  AssetKind,
  AssetUpload,
  CreateAssetUploadRequest,
  SetAccountAvatarRequest,
} from "@/api/hubTypes";

export interface UploadedAsset {
  assetId: string;
  url: string;
}

export interface AssetQuota {
  usedBytes: number;
  quotaBytes: number;
}

const QUOTA_EXCEEDED = 507;

export function assetQuotaFromError(error: unknown): AssetQuota | null {
  if (!(error instanceof HubRequestError) || error.status !== QUOTA_EXCEEDED) return null;
  try {
    return JSON.parse(error.message) as AssetQuota;
  } catch {
    return null;
  }
}

/** The presigned URL authenticates itself through its query string and must not
 *  carry our hub token, so it goes out on the webview's own `fetch` rather than
 *  `platformFetch` — which would route it through Tauri's HTTP plugin and its
 *  build-time URL allowlist, pinning the bucket at compile time. */
export async function uploadAsset(kind: AssetKind, blob: Blob): Promise<UploadedAsset> {
  const request: CreateAssetUploadRequest = { kind, byteSize: blob.size };
  const upload = await hubJson<AssetUpload>("/api/assets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: blob,
  });
  if (!response.ok) throw new Error(`Could not upload the image (${response.status})`);
  return { assetId: upload.assetId, url: upload.publicUrl };
}

export function fetchAccountAssets(): Promise<AccountAssetList> {
  return hubJson<AccountAssetList>("/api/assets");
}

export async function deleteAsset(assetId: string): Promise<void> {
  await hubRequest(`/api/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
}

export async function setAccountAvatar(assetId: string | undefined): Promise<void> {
  const request: SetAccountAvatarRequest = { assetId };
  await hubRequest("/api/auth/me/avatar", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
}
