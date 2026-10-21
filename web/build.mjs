// Empaqueta la página en web/dist: main.js (xterm.js incluido), worker.js (el emulador), la imagen.
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const here = import.meta.dirname;
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });
const common = { bundle: true, format: "iife", target: "es2022", minify: true, sourcemap: true, logLevel: "warning" };
await build({ ...common, entryPoints: [join(here, "main.ts")], outfile: join(dist, "main.js") });
await build({ ...common, entryPoints: [join(here, "worker.ts")], outfile: join(dist, "worker.js") });
copyFileSync(join(here, "index.html"), join(dist, "index.html"));
copyFileSync(join(here, "node_modules/@xterm/xterm/css/xterm.css"), join(dist, "xterm.css"));
const image = join(here, "../build/linux/Image");
if (!existsSync(image)) throw new Error("falta build/linux/Image: ejecuta ./setup.sh");
copyFileSync(image, join(dist, "Image"));
console.log("web/dist listo");
