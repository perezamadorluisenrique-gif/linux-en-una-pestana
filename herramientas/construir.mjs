// Builds the static website into _site/ (what GitHub Pages serves):
//   index.html      home page: the emulator (xterm.js + Web Worker) and the course chapters
//   curso/*.html    the course, rendered from curso/*.md with `marked`
//   main.js, worker.js, xterm.css, Image (Linux kernel + initramfs, GPL; see CREDITOS.md)
// Usage: npm run imagen && npm run build      (REPO_URL changes where source-code links point)
import { build } from "esbuild";
import { marked } from "marked";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.join(import.meta.dirname, "..");
const SITE = path.join(ROOT, "_site");
const REPO = (process.env.REPO_URL || "https://github.com/perezamadorluisenrique-gif/linux-en-una-pestana").replace(/\/$/, "");
const IMAGE = path.join(ROOT, "build/linux/Image");
if (!fs.existsSync(IMAGE)) throw new Error("falta build/linux/Image: npm run imagen");

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(path.join(SITE, "curso"), { recursive: true });

// 1. Emulator bundles (same entry points as web/build.mjs).
const common = { bundle: true, format: "iife", target: "es2022", minify: true, logLevel: "warning" };
await build({ ...common, entryPoints: [path.join(ROOT, "web/main.ts")], outfile: path.join(SITE, "main.js") });
await build({ ...common, entryPoints: [path.join(ROOT, "web/worker.ts")], outfile: path.join(SITE, "worker.js") });
const req = createRequire(import.meta.url);
fs.copyFileSync(req.resolve("@xterm/xterm/css/xterm.css"), path.join(SITE, "xterm.css"));
fs.copyFileSync(IMAGE, path.join(SITE, "Image"));
fs.copyFileSync(path.join(ROOT, "sitio/estilo.css"), path.join(SITE, "estilo.css"));

// 2. Course chapters.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const files = fs.readdirSync(path.join(ROOT, "curso")).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
const pageOf = (f) => (f.startsWith("00-") ? "index.html" : `${f.slice(0, 2)}.html`);
const chapters = files.map((f) => {
  const md = fs.readFileSync(path.join(ROOT, "curso", f), "utf8");
  const title = /^# (.+)$/m.exec(md)[1].trim();
  return { file: f, page: pageOf(f), title, md };
});

function rewriteLinks(html) {
  return html.replace(/href="([^"]+)"/g, (all, href) => {
    if (/^[a-z]+:|^#/.test(href)) return all;
    const [p, hash = ""] = href.split(/(?=#)/);
    const ch = /^(\d\d-[^/]+\.md)$/.exec(p);
    if (ch) return `href="${pageOf(ch[1])}${hash}"`;
    if (p.startsWith("../")) {
      const rel = path.posix.normalize(p.slice(3));
      const kind = fs.existsSync(path.join(ROOT, rel)) && fs.statSync(path.join(ROOT, rel)).isDirectory() ? "tree" : "blob";
      return `href="${REPO}/${kind}/main/${rel}${hash}"`;
    }
    return all;
  });
}
// Scrollable blocks must be keyboard-focusable (axe: scrollable-region-focusable).
const focusable = (html) => { let n = 0; return html.replace(/<pre>/g, '<pre tabindex="0">')
  .replace(/<table>/g, () => `<div class="tabla" tabindex="0" role="region" aria-label="Tabla ${++n}"><table>`)
  .replace(/<\/table>/g, "</table></div>"); };

const footer = (prefix) => `<footer>
  <p>Código del emulador: licencia MIT. Texto del curso: CC BY 4.0. La imagen de Linux que arranca la página
  (kernel 6.1.14 y busybox) es GPL; sus fuentes se indican en <a href="${REPO}/blob/main/CREDITOS.md">CREDITOS.md</a>.</p>
  <p><a href="${prefix}index.html">Inicio</a> · <a href="${REPO}">Código fuente</a></p>
</footer>`;

function chapterPage(c, i) {
  const body = focusable(rewriteLinks(marked.parse(c.md, { gfm: true })));
  const prev = chapters[i - 1], next = chapters[i + 1];
  const nav = `<nav class="pasos" aria-label="Capítulos">
    ${prev ? `<a rel="prev" href="${prev.page}">← ${esc(prev.title)}</a>` : "<span></span>"}
    ${next ? `<a rel="next" href="${next.page}">${esc(next.title)} →</a>` : "<span></span>"}
  </nav>`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title.replace(/^\d+\.\s*/, ""))} · Linux en una pestaña</title>
<link rel="stylesheet" href="../estilo.css">
</head>
<body>
<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="barra"><a href="../index.html">Linux en una pestaña</a> <span aria-hidden="true">/</span> <a href="index.html">Curso</a></header>
<main id="contenido" class="capitulo">
${body}
${nav}
</main>
${footer("../")}
</body>
</html>
`;
}
chapters.forEach((c, i) => fs.writeFileSync(path.join(SITE, "curso", c.page), chapterPage(c, i)));

// 3. Home page: template sitio/inicio.html with the chapter list from curso/00-indice.md.
const index = chapters[0].md;
const items = chapters.slice(1).map((c) => {
  const m = new RegExp(`\\[([^\\]]+)\\]\\(${c.file.replace(/\./g, "\\.")}\\):\\s*(.+)$`, "m").exec(index);
  const label = m ? m[1] : c.title.replace(/^\d+\.\s*/, "");
  const desc = m ? m[2].trim().replace(/^./, (x) => x.toUpperCase()) : "";
  return `<li><a href="curso/${c.page}">${esc(label)}</a>${desc ? `<span>${esc(desc)}</span>` : ""}</li>`;
}).join("\n      ");
const home = fs.readFileSync(path.join(ROOT, "sitio/inicio.html"), "utf8")
  .replace("{{CAPITULOS}}", items).replaceAll("{{REPO}}", REPO).replace("{{PIE}}", footer(""));
fs.writeFileSync(path.join(SITE, "index.html"), home);

// 4. English home page (en/index.html): template sitio/inicio.en.html; the chapters stay in Spanish.
// Its main.js is web/main.ts with the status texts in English and the worker one level up (the source is not edited).
const EN_CHAPTERS = [
  ["The processor as a loop", "fetch, decode, execute, repeat."],
  ["Decoding", "from 32 bits to an instruction; formats and immediates."],
  ["The ALU and the M extension", "32-bit arithmetic in JavaScript, multiply and divide."],
  ["Memory and I/O", "RAM, the bus and memory-mapped devices."],
  ["CSRs and traps", "control registers, exceptions, interrupts and atomics."],
  ["Devices and the device tree", "UART, CLINT, syscon and how we describe them to Linux."],
  ["Booting Linux", "from the kernel's first instruction to the shell, in Node and on the web."],
  ["Performance", "measuring MIPS and where the time goes."],
];
if (EN_CHAPTERS.length !== chapters.length - 1) throw new Error("EN_CHAPTERS no cubre los capítulos del curso");
const itemsEn = chapters.slice(1).map((c, i) =>
  `<li><a href="../curso/${c.page}" hreflang="es">${i + 1}. ${esc(EN_CHAPTERS[i][0])}</a><span>${esc(EN_CHAPTERS[i][1].replace(/^./, (x) => x.toUpperCase()))}</span></li>`).join("\n      ");
fs.mkdirSync(path.join(SITE, "en"), { recursive: true });
fs.writeFileSync(path.join(SITE, "en", "index.html"), fs.readFileSync(path.join(ROOT, "sitio/inicio.en.html"), "utf8")
  .replace("{{CAPITULOS}}", itemsEn).replaceAll("{{REPO}}", REPO));
const EN_UI = [['new Worker("worker.js")', 'new Worker("../worker.js")'], ["`arrancando (", "`booting ("],
  ["MB de imagen)…`", "MB image)…`"], [" M instrucciones · ", " M instructions · "], ["`máquina: ", "`machine: "]];
const english = { name: "english-ui", setup(b) {
  b.onLoad({ filter: /web[\\/]main\.ts$/ }, (args) => {
    let src = fs.readFileSync(args.path, "utf8");
    for (const [es, en] of EN_UI) {
      if (!src.includes(es)) throw new Error(`main.ts ya no contiene ${es}: actualiza EN_UI`);
      src = src.replace(es, en);
    }
    return { contents: src, loader: "ts" };
  });
} };
await build({ ...common, entryPoints: [path.join(ROOT, "web/main.ts")], outfile: path.join(SITE, "en", "main.js"), plugins: [english] });

const size = (d) => fs.readdirSync(d, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`_site: ${(size(SITE) / 1e6).toFixed(1)} MB; inicio + ${chapters.length - 1} capítulos + índice del curso`);
