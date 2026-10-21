// Puntuación del reto: comprueba cada peldaño de CHARTER.md y dice hasta dónde llega.
// Uso: ./score   (o node tools/score.ts). Los peldaños son acumulativos: Rn exige R0..Rn-1.
import { existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { runTest } from "../tests/riscv-tests/run.ts";

const ROOT = join(import.meta.dirname, "..");
const TESTS = join(ROOT, "build/riscv-tests");

type Check = { rung: string; ok: boolean; detail: string };
const checks: Check[] = [];

// R0: los riscv-tests existen (se compilan si faltan) y se pueden ejecutar.
if (!existsSync(TESTS) || readdirSync(TESTS).filter((f) => f.includes("-p-")).length < 70) {
  execFileSync("bash", [join(ROOT, "tests/riscv-tests/build.sh")], { stdio: "inherit" });
}
const suites: Record<string, { pass: number; total: number; failed: string[] }> = {};
for (const f of readdirSync(TESTS).filter((f) => /^rv32(ui|um|ua|mi)-p-[\w-]+$/.test(f)).sort()) {
  const s = f.split("-")[0];
  suites[s] ??= { pass: 0, total: 0, failed: [] };
  let ok = false;
  try { ok = runTest(join(TESTS, f)).ok; } catch { ok = false; }
  suites[s].total++;
  if (ok) suites[s].pass++; else suites[s].failed.push(f);
}
const fmt = (s: string) => suites[s] ? `${s} ${suites[s].pass}/${suites[s].total}` +
  (suites[s].failed.length ? ` (fallan: ${suites[s].failed.join(", ")})` : "") : `${s} -`;
const full = (s: string) => !!suites[s] && suites[s].total > 0 && suites[s].pass === suites[s].total;
const total = Object.values(suites).reduce((a, s) => a + s.total, 0);

checks.push({ rung: "R0", ok: total >= 70, detail: `${total} riscv-tests compilados y ejecutados` });
checks.push({ rung: "R1", ok: full("rv32ui") && full("rv32um"), detail: `${fmt("rv32ui")}; ${fmt("rv32um")}` });
checks.push({ rung: "R2", ok: full("rv32ua") && full("rv32mi"), detail: `${fmt("rv32ua")}; ${fmt("rv32mi")}` });

// R3 en adelante: los añade cada peldaño cuando existe su arnés.
const extra = join(ROOT, "tools/score-linux.ts");
if (existsSync(extra)) {
  const mod = await import(extra);
  for (const c of await mod.linuxChecks() as Check[]) checks.push(c);
}

const web = join(ROOT, "tools/score-web.ts");
if (existsSync(web)) {
  const mod = await import(web);
  for (const c of await mod.webChecks() as Check[]) checks.push(c);
}

const curso = join(ROOT, "tools/score-curso.ts");
if (existsSync(curso)) {
  const mod = await import(curso);
  for (const c of mod.cursoChecks() as Check[]) checks.push(c);
}

const perf = join(ROOT, "tools/score-perf.ts");
if (existsSync(perf)) {
  const mod = await import(perf);
  for (const c of mod.perfChecks() as Check[]) checks.push(c);
}

let rung = "-";
for (const c of checks) {
  console.log(`${c.ok ? "OK   " : "NO   "} ${c.rung}  ${c.detail}`);
}
for (const c of checks) { if (!c.ok) break; rung = c.rung; }
console.log(`\nfecha: ${new Date().toISOString()}`);
console.log(`peldaño: ${rung}`);
