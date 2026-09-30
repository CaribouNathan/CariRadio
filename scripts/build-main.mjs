// Bundle du processus principal et du preload (CommonJS, Electron externe) + ressources du processus principal.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "info" };
await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main.cjs" });
await build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/preload.cjs" });
// icône de la barre des menus (image « template » : macOS l'adapte au thème clair/sombre)
mkdirSync("dist", { recursive: true });
for (const f of ["trayTemplate.png", "trayTemplate@2x.png"]) copyFileSync(`assets/${f}`, `dist/${f}`);
