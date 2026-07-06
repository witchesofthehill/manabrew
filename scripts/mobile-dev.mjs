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

if (target === "ios" && args[0] === "dev" && args.length === 1 && platform() === "darwin") {
  const chosen = await pickIosSimulator();
  if (chosen) {
    spawnSync("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", chosen.udid], {
      stdio: "ignore",
    });
    if (chosen.state !== "Booted") {
      console.log(`[mobile-dev] booting ${chosen.name} (${chosen.os})… (waits until ready)`);
    }
    spawnSync("xcrun", ["simctl", "bootstatus", chosen.udid, "-b"], { stdio: "ignore" });
    args.push(chosen.name);
  } else {
    spawnSync("open", ["-a", "Simulator"], { stdio: "ignore" });
  }
}

async function pickIosSimulator() {
  const list = spawnSync("xcrun", ["simctl", "list", "devices", "available", "--json"], {
    encoding: "utf8",
  });
  if (list.status !== 0) return null;
  const devices = [];
  for (const [runtime, entries] of Object.entries(JSON.parse(list.stdout).devices)) {
    if (!runtime.includes("SimRuntime.iOS")) continue;
    const os = runtime.replace(/^.*SimRuntime\.iOS-/, "iOS ").replace(/-/g, ".");
    for (const d of entries) {
      if (d.isAvailable) devices.push({ name: d.name, udid: d.udid, state: d.state, os });
    }
  }
  if (devices.length === 0) return null;
  devices.sort(
    (a, b) =>
      b.os.localeCompare(a.os, undefined, { numeric: true }) || a.name.localeCompare(b.name),
  );
  const booted = devices.find((d) => d.state === "Booted");
  if (booted) {
    console.log(`[mobile-dev] using booted simulator: ${booted.name} (${booted.os})`);
    return booted;
  }
  if (!process.stdin.isTTY) return null;

  console.log("Available simulators:");
  devices.forEach((d, i) => {
    console.log(`  ${i + 1}) ${d.name} (${d.os})${d.state === "Booted" ? " — booted" : ""}`);
  });
  const def = devices.findIndex((d) => d.state === "Booted") + 1 || 1;
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Select a simulator to boot [${def}]: `)).trim();
  rl.close();
  const idx = Number.parseInt(answer === "" ? String(def) : answer, 10);
  if (!Number.isInteger(idx) || idx < 1 || idx > devices.length) {
    console.error(`[mobile-dev] invalid selection: ${answer}`);
    process.exit(1);
  }
  return devices[idx - 1];
}

const res = spawnSync("yarn", ["tauri", target, ...args], {
  stdio: "inherit",
  env,
  shell: platform() === "win32",
});
if (res.error) console.error(`[mobile-dev] ${res.error.message}`);
process.exit(res.status ?? 1);
