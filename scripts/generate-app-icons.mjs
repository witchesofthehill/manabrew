#!/usr/bin/env node
import { execFileSync } from "child_process";
import { copyFileSync, cpSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const root = fileURLToPath(new URL("..", import.meta.url));
const icons = join(root, "src-tauri", "icons");
const source = join(icons, "source.json");
const { bg_color: background } = JSON.parse(readFileSync(source, "utf8"));
const tauri = join(root, "node_modules", "@tauri-apps", "cli", "tauri.js");
const options = Object.freeze({ cwd: root, stdio: "inherit" });

execFileSync(process.execPath, [tauri, "icon", source], options);
execFileSync(
  process.execPath,
  [tauri, "icon", source, "--png", "64", "--png", "256", "--png", "512", "--png", "1024"],
  options,
);

const ios = join(root, "src-tauri", "gen", "apple", "Assets.xcassets", "AppIcon.appiconset");
const iosImages = readdirSync(ios)
  .filter((name) => name.endsWith(".png"))
  .map((name) => join(ios, name));
execFileSync(
  "magick",
  ["mogrify", "-background", background, "-alpha", "remove", "-alpha", "off", ...iosImages],
  options,
);

const android = join(root, "src-tauri", "gen", "android", "app", "src", "main", "res");
for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
  execFileSync(
    "magick",
    [join(android, "mipmap-xxxhdpi", name), "-resize", "72x72", join(android, "mipmap-hdpi", name)],
    options,
  );
}
for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi", "anydpi-v26"]) {
  cpSync(join(android, `mipmap-${density}`), join(icons, "android", `mipmap-${density}`), {
    recursive: true,
  });
}
copyFileSync(
  join(android, "values", "ic_launcher_background.xml"),
  join(icons, "android", "values", "ic_launcher_background.xml"),
);
