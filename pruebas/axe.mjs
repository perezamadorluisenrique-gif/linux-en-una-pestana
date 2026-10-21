// Accessibility check (npm test, after npm run build): axe-core on the home page (before and after
// booting Linux) and on every course page, in light and dark mode. Fails on any `serious` or
// `critical` violation. Writes the full report to pruebas/axe-informe.json.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { servir, SITE } from "./servidor.mjs";

const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const { server, base } = await servir();
const caps = fs.readdirSync(path.join(SITE, "curso")).filter((f) => f.endsWith(".html")).sort();
const PAGES = [["inicio", "index.html", false], ["inicio (arrancado)", "index.html", true],
  ["inicio en", "en/index.html", false], ["inicio en (arrancado)", "en/index.html", true],
  ...caps.map((f) => [`curso/${f}`, `curso/${f}`, false])];

const browser = await chromium.launch();
const report = [];
let serious = 0;
try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ colorScheme: scheme });
    for (const [name, url, boot] of PAGES) {
      const page = await ctx.newPage();
      await page.goto(base + url);
      if (boot) {
        await page.getByRole("button", { name: /^(Arrancar|Boot)$/ }).click();
        await page.waitForFunction(() => /login:/.test(Array.from({ length: window.term.buffer.active.length },
          (_, i) => window.term.buffer.active.getLine(i)?.translateToString(true) ?? "").join("\n")), null, { timeout: 90_000 });
      }
      await page.addScriptTag({ content: AXE });
      const r = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      serious += bad.length;
      report.push({ page: name, scheme, violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, example: v.nodes[0]?.target })) });
      console.log(`${bad.length ? "FALLO" : "ok   "} ${scheme.padEnd(5)} ${name}: ` +
        (r.violations.length ? r.violations.map((v) => `${v.id}(${v.impact}×${v.nodes.length})`).join(" ") : "sin infracciones"));
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(import.meta.dirname, "axe-informe.json"), JSON.stringify(report, null, 1));
console.log(serious ? `axe: ${serious} infracciones serious/critical` : "axe: OK (0 serious/critical)");
process.exit(serious ? 1 : 0);
