import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist/pages-out");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Static SPA from Vite client build
cpSync(join(root, "dist/client"), out, { recursive: true });

// Bundle Pages advanced-mode worker as _worker.js (tiny proxy — no partyserver)
await build({
  entryPoints: [join(root, "src/pages-entry.ts")],
  outfile: join(out, "_worker.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  logLevel: "info",
});

// Ensure SPA not_found style: Pages serves index for client routes via worker fallback
const ignore = join(out, ".assetsignore");
try {
  const existing = readFileSync(ignore, "utf8");
  if (!existing.includes("_worker.js")) {
    writeFileSync(ignore, existing.trim() + "\n_worker.js\n");
  }
} catch {
  writeFileSync(ignore, "_worker.js\n");
}

console.log("Pages output ready at dist/pages-out");
