// Bundle du processus principal et du preload (CommonJS, Electron externe).
import { build } from "esbuild";
const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "info" };
await build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main.cjs" });
await build({ ...common, entryPoints: ["src/main/preload.ts"], outfile: "dist/preload.cjs" });
