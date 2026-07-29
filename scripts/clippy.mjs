import { spawnSync } from "node:child_process";

const config = process.env.TAURI_CONFIG ? JSON.parse(process.env.TAURI_CONFIG) : {};
const resources = {
  ...config.bundle?.resources,
  "../forge-harness/native/build/libforgeharness.dylib": null,
  "../forge-harness/native/build/forgeharness.dll": null,
};
const tauriConfig = JSON.stringify({
  ...config,
  bundle: {
    ...config.bundle,
    resources,
  },
});
const result = spawnSync(
  "cargo",
  ["clippy", "--workspace", "--lib", "--bins", "--", "-D", "warnings"],
  {
    stdio: "inherit",
    env: { ...process.env, TAURI_CONFIG: tauriConfig },
  },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
