// Ejecuta los riscv-tests compilados. Uso:
//   node tests/riscv-tests/run.ts [prefijo...]       p. ej. rv32ui rv32um
// Imprime una línea por test y un resumen por suite; con --json, solo el resumen en JSON.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Bus } from "../../src/bus.ts";
import { CPU } from "../../src/cpu.ts";
import { parseElf } from "../../src/elf.ts";

const DIR = join(import.meta.dirname, "../../build/riscv-tests");
const MAX_INSNS = 5_000_000;

/**
 * Ejecuta un test con los dos motores: el rápido (WebAssembly, fast.ts) y el intérprete en
 * TypeScript solo. Pasa si pasa con los dos.
 */
export function runTest(path: string): { ok: boolean; detail: string } {
  const fast = runWith(path, true);
  const slow = runWith(path, false);
  if (fast.ok && slow.ok) return fast;
  return { ok: false, detail: `${fast.ok ? "" : `motor rápido: ${fast.detail}`}` +
    `${!fast.ok && !slow.ok ? "; " : ""}${slow.ok ? "" : `intérprete: ${slow.detail}`}` };
}

function runWith(path: string, useFast: boolean): { ok: boolean; detail: string } {
  const elf = parseElf(readFileSync(path));
  const bus = new Bus(0x80000000, 1 << 20);
  for (const s of elf.segments) bus.load(s.addr, s.data);
  const cpu = new CPU(bus);
  cpu.useFast = useFast;
  cpu.reset(elf.entry);
  const tohost = elf.symbols.get("tohost");
  if (tohost === undefined) return { ok: false, detail: "sin símbolo tohost" };
  const off = tohost - bus.ramBase;
  let total = 0;
  while (total < MAX_INSNS) {
    total += cpu.run(1000);
    if (cpu.waiting) cpu.waiting = false; // ningún test espera una interrupción de verdad
    const v = bus.view.getUint32(off, true);
    if (v !== 0) {
      // Convención de riscv-tests: 1 = pasa; (n << 1) | 1 = falla el caso n.
      return v === 1
        ? { ok: true, detail: `${total} instr.` }
        : { ok: false, detail: `falla el caso ${v >>> 1}` };
    }
  }
  return { ok: false, detail: `sin terminar tras ${MAX_INSNS} instr. (pc=0x${(cpu.pc >>> 0).toString(16)})` };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const prefixes = args.filter((a) => !a.startsWith("--"));
  const files = readdirSync(DIR).filter((f) => /^rv32\w+-p-/.test(f) && !f.includes("."))
    .filter((f) => prefixes.length === 0 || prefixes.some((p) => f.startsWith(p))).sort();
  const suites: Record<string, { pass: number; total: number; failed: string[] }> = {};
  for (const f of files) {
    const suite = f.split("-")[0];
    suites[suite] ??= { pass: 0, total: 0, failed: [] };
    let r: { ok: boolean; detail: string };
    try { r = runTest(join(DIR, f)); } catch (e) { r = { ok: false, detail: String(e) }; }
    suites[suite].total++;
    if (r.ok) suites[suite].pass++; else suites[suite].failed.push(f);
    if (!json) console.log(`${r.ok ? "PASA " : "FALLA"} ${f}  ${r.detail}`);
  }
  if (json) console.log(JSON.stringify(suites));
  else for (const [s, r] of Object.entries(suites)) console.log(`${s}: ${r.pass}/${r.total}`);
}
