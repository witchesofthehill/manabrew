import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function loadActivityKey(stateDirectory, { create = false } = {}) {
  const file = path.join(stateDirectory, "analytics-hmac.key");
  if (create && !existsSync(file))
    writeFileSync(file, randomBytes(32), { mode: 0o600, flag: "wx" });
  const key = readFileSync(file);
  if (key.length !== 32) throw new Error("Invalid analytics HMAC key");
  return key;
}

export function activityId(key, environment, handle) {
  return createHmac("sha256", key)
    .update("manabrew-client-analytics:v1\0")
    .update(environment)
    .update("\0")
    .update(handle)
    .digest("hex")
    .slice(0, 16);
}
