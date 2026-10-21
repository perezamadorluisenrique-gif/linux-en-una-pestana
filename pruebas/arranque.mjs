// Boot test (npm test, after npm run build): serves _site/, opens the home page in Chromium,
// presses «Arrancar», waits for the login prompt in the xterm.js buffer, logs in as root,
// runs `uname -a` and checks the answer.
import { chromium } from "playwright";
import { servir } from "./servidor.mjs";

const { server, base } = await servir();
const browser = await chromium.launch();
const t0 = performance.now();
const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
let ok = false, detail = "";
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const ruta = process.argv[2] ?? ""; // "en/" tests the English home page
  await page.goto(base + ruta);
  const text = () => page.evaluate(() => {
    const b = window.term.buffer.active; const out = [];
    for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? "");
    return out.join("\n");
  });
  const waitFor = async (re, ms) => {
    const end = performance.now() + ms;
    while (performance.now() < end) { if (re.test(await text())) return true; await page.waitForTimeout(100); }
    return false;
  };
  await page.getByRole("button", { name: /^(Arrancar|Boot)$/ }).click();
  if (!(await waitFor(/login: *$/m, 90_000))) detail = "no llega al login en 90 s";
  else {
    const tLogin = secs();
    await page.keyboard.type("root\n");
    if (!(await waitFor(/# *$/m, 30_000))) detail = "no aparece el prompt tras root";
    else {
      await page.keyboard.type("uname -a\n");
      ok = await waitFor(/Linux buildroot 6\.1\.14 .*riscv32 GNU\/Linux/, 30_000);
      detail = `login en ${tLogin} s; shell y uname -a ${ok ? "OK" : "MAL"}`;
    }
  }
  if (errors.length) { ok = false; detail += `; errores de la página: ${errors[0]}`; }
} finally {
  await browser.close();
  server.close();
}
console.log(`arranque: ${ok ? "OK" : "NO"} (${detail})`);
process.exit(ok ? 0 : 1);
