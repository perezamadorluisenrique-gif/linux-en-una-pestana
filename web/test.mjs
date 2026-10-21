// Prueba de la página (peldaño R5): sirve web/dist, la abre en Chromium con Playwright, espera el
// login en el buffer de xterm.js, entra como root, escribe `uname -a` y lee la respuesta.
// Uso: node web/test.mjs   (antes: node web/build.mjs). Exporta webCheck() para tools/score-web.ts.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, join, normalize } from "node:path";

const DIST = join(import.meta.dirname, "dist");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".map": "application/json" };

function loadPlaywright() {
  const req = createRequire(import.meta.url);
  for (const p of ["playwright", "/opt/npm-tools/node_modules/playwright"]) {
    try { return req(p); } catch { /* siguiente */ }
  }
  throw new Error("no encuentro playwright");
}

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
    try {
      const file = path === "/" || path === "\\" ? "index.html" : path;
      const body = await readFile(join(DIST, file));
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

export async function webCheck({ log = () => {} } = {}) {
  const { chromium } = loadPlaywright();
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/?autoboot`;
  const browser = await chromium.launch();
  const t0 = performance.now();
  const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
  try {
    const page = await browser.newPage();
    await page.goto(url);
    const text = () => page.evaluate(() => {
      const b = window.term.buffer.active; const out = [];
      for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
      return out.join("\n");
    });
    const waitFor = async (re, ms) => {
      const end = performance.now() + ms;
      while (performance.now() < end) { const t = await text(); if (re.test(t)) return t; await page.waitForTimeout(100); }
      return null;
    };
    const type = (s) => page.keyboard.type(s);
    await page.locator("#term").click();
    if (!(await waitFor(/login: *$/m, 90_000))) return { ok: false, detail: "la página no llega al login en 90 s" };
    const tLogin = secs();
    log(`login en ${tLogin} s`);
    await type("root\n");
    if (!(await waitFor(/# *$/m, 30_000))) return { ok: false, detail: "no aparece el prompt tras root" };
    await type("uname -a\n");
    const t = await waitFor(/Linux buildroot 6\.1\.14 .*riscv32 GNU\/Linux/, 30_000);
    const status = await page.locator("#status").textContent();
    const mips = /([\d.]+) MIPS/.exec(status ?? "")?.[1];
    return {
      ok: !!t,
      detail: `Chromium: login en ${tLogin} s; uname -a ${t ? "OK" : "MAL"}${mips ? `; ~${mips} MIPS en el worker` : ""}`,
    };
  } finally {
    await browser.close();
    server.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await webCheck({ log: (s) => console.log(s) });
  console.log(`${r.ok ? "OK" : "NO"}  ${r.detail}`);
  process.exit(r.ok ? 0 : 1);
}
