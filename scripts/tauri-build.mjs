import { spawnSync } from "node:child_process";

const BUNDLE_FLAGS = ["-b", "--bundles"];
const ALL_TARGETS_CONFIG = JSON.stringify({ bundle: { targets: "all" } });

const args = [];
let choseBundles = false;
const input = process.argv.slice(2);
for (let i = 0; i < input.length; i++) {
  const [flag, inlineValue] = input[i].split("=", 2);
  if (flag === "--no-bundle") {
    choseBundles = true;
  } else if (BUNDLE_FLAGS.includes(flag)) {
    choseBundles = true;
    const value = inlineValue ?? input[i + 1];
    if (value === "all") {
      args.push("--config", ALL_TARGETS_CONFIG);
      if (inlineValue === undefined) i++;
      continue;
    }
  }
  args.push(input[i]);
}

if (process.platform === "linux" && !choseBundles) {
  console.error(
    "Choose the Linux bundles to build:\n" +
      "  yarn build --bundles appimage        (or deb, rpm; comma-separated for several)\n" +
      "  yarn build --bundles all\n" +
      "  yarn build --no-bundle               (binary only)",
  );
  process.exit(1);
}

const result = spawnSync("tauri", ["build", "--config", "src-tauri/tauri.dev.conf.json", ...args], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
