import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const source = process.cwd();
const { build } = await import(
  pathToFileURL(path.join(source, "node_modules/vite/dist/node/index.js")).href
);

for (const name of ["renderer", "pixels"]) {
  const file = `packages/browser/generated/${name}.js`;
  const contents = await readFile(file, "utf8");
  await writeFile(
    file,
    `import wasmUrl from './${name}_bg.wasm?url';\n` +
      contents.replace(
        "new URL(/* @vite-ignore */ wasmPath, import.meta.url)",
        "wasmUrl",
      ),
  );
}

await build({
  configFile: false,
  resolve: {
    alias: {
      "@card-glint/browser": path.join(source, "packages/browser/src/index.ts"),
    },
  },
  build: {
    target: "es2022",
    outDir: "dist/lib",
    emptyOutDir: true,
    lib: {
      entry: {
        browser: "packages/browser/src/index.ts",
        magic: "games/magic/src/index.ts",
        "magic-presentation": "games/magic/src/presentation.ts",
        "magic-offline-assets": "games/magic/src/offline-assets.ts",
        kernels: "packages/browser/src/kernels.ts",
        finish: "packages/browser/src/finish.ts",
      },
      formats: ["es"],
      fileName: (_, name) => `${name}.js`,
    },
    cssCodeSplit: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      external: (id) => id.endsWith("_bg.wasm?url"),
      output: {
        paths: (id) => id.endsWith("_bg.wasm?url") ? `./${path.basename(id)}` : id,
      },
    },
  },
});
for (const name of ["renderer", "pixels"]) {
  await cp(`packages/browser/generated/${name}_bg.wasm`, `dist/lib/${name}_bg.wasm`);
}
await cp("games/magic/fonts.css", "dist/lib/magic.css");
execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--project", "tsconfig.build.json", "--maxNodeModuleJsDepth", "1"],
  { stdio: "inherit" },
);
await mkdir("dist/types/packages/browser/generated", { recursive: true });
for (const name of ["renderer", "pixels"]) {
  await cp(`packages/browser/generated/${name}.d.ts`, `dist/types/packages/browser/generated/${name}.d.ts`);
}
for (const game of ["magic", "showcase"]) {
  await cp(`games/${game}/assets.json`, `dist/types/games/${game}/assets.json`);
}
