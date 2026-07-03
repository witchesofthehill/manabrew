// Launcher for `yarn android` / `yarn ios`: fills in the Android SDK/NDK env
// (ANDROID_HOME / NDK_HOME) when the shell doesn't export it — Tauri and
// `ring`'s C build both need the NDK toolchain on the target platform — then
// execs the tauri CLI with the given subcommand.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import path from "node:path";

const [target, ...args] = process.argv.slice(2);
if (target !== "android" && target !== "ios") {
  console.error("usage: node scripts/mobile-dev.mjs <android|ios> [tauri args…]");
  process.exit(1);
}

const env = { ...process.env };

if (target === "android") {
  const sdkCandidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    path.join(homedir(), "Library/Android/sdk"),
    path.join(homedir(), "Android/Sdk"),
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "Android/Sdk") : undefined,
  ].filter(Boolean);
  const sdk = sdkCandidates.find((p) => existsSync(p));
  if (!sdk) {
    console.error("Android SDK not found. Install it via Android Studio, or export ANDROID_HOME.");
    process.exit(1);
  }
  env.ANDROID_HOME ??= sdk;

  if (!env.NDK_HOME && !env.ANDROID_NDK_HOME) {
    const ndkRoot = path.join(sdk, "ndk");
    const versions = existsSync(ndkRoot)
      ? readdirSync(ndkRoot).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      : [];
    const newest = versions.at(-1);
    if (!newest) {
      console.error(
        `No NDK found under ${ndkRoot}. Install one via Android Studio's SDK Manager (SDK Tools → NDK), or export NDK_HOME.`,
      );
      process.exit(1);
    }
    env.NDK_HOME = path.join(ndkRoot, newest);
    env.ANDROID_NDK_HOME = env.NDK_HOME;
    console.log(`[mobile-dev] NDK_HOME=${env.NDK_HOME}`);
  }
}

const yarn = platform() === "win32" ? "yarn.cmd" : "yarn";
const res = spawnSync(yarn, ["tauri", target, ...args], { stdio: "inherit", env });
process.exit(res.status ?? 1);
