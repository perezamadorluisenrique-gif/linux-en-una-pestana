// Banco de pruebas de rendimiento (peldaño R7): arranca Linux con un reloj virtual determinista
// (1 µs cada 50 instrucciones; las esperas de WFI se saltan) y mide cuánto tiempo de CPU del
// hilo tarda en ejecutar las primeras N instrucciones. Compara la CPU actual (src/) con la de partida (tools/perf/base/,
// copia de src/ en el commit 995db06, la que dio ~57 MIPS) en la misma máquina y en rondas
// alternas, para que el ruido de la máquina afecte igual a las dos.
// Uso: node tools/perf/bench.ts [millones=20] [rondas=8]  (se queda con la mejor ronda de cada una)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Machine as Cur } from "../../src/machine.ts";
import { Machine as Base } from "./base/machine.ts";

const ROOT = join(import.meta.dirname, "../..");
type Ctor = typeof Cur | typeof Base;

export interface Run { mips: number; out: string }

/** Ejecuta `n` instrucciones del arranque y devuelve los MIPS (solo tiempo de CPU emulada). */
export function bootMips(M: Ctor, image: Uint8Array, n: number): Run {
  let skipped = 0;
  // deno-lint-ignore prefer-const
  let m: InstanceType<Ctor>;
  const clock = () => skipped + Math.floor(m.cpu.instret / 50);
  m = new M({ clock });
  m.loadKernel(image);
  let out = "";
  m.uart.onTransmit = (b: number) => { out += String.fromCharCode(b); };
  // Tiempo de CPU del hilo (no de pared): el que la máquina virtual nos roba no cuenta.
  const cpu0 = process.threadCpuUsage();
  while (m.cpu.instret < n && m.power === "running") {
    const idle = m.step(Math.min(1_000_000, n - m.cpu.instret));
    if (idle > 0) skipped += idle;
  }
  const c = process.threadCpuUsage(cpu0);
  const ms = (c.user + c.system) / 1000;
  return { mips: m.cpu.instret / ms / 1000, out };
}

export function compare(millions = 20, rounds = 8) {
  const image = readFileSync(join(ROOT, "build/linux/Image"));
  const n = millions * 1e6;
  const base: number[] = [], cur: number[] = [];
  let same = true;
  for (let i = 0; i < rounds; i++) {
    const b = bootMips(Base, image, n);
    const c = bootMips(Cur, image, n);
    // Las marcas de tiempo del kernel pueden variar (el reloj virtual depende de cuándo se
    // atienden las interrupciones); el texto del arranque tiene que ser el mismo.
    const text = (o: string) => o.replace(/^\[ *[\d.]+\] /gm, "");
    if (text(b.out) !== text(c.out)) same = false;
    base.push(b.mips); cur.push(c.mips);
  }
  const best = (a: number[]) => Math.max(...a);
  return { base: best(base), cur: best(cur), ratio: best(cur) / best(base), same, n };
}

if (import.meta.main) {
  const [mi = "20", r = "8"] = process.argv.slice(2);
  const res = compare(Number(mi), Number(r));
  console.log(`base ${res.base.toFixed(1)} MIPS; actual ${res.cur.toFixed(1)} MIPS; ` +
    `x${res.ratio.toFixed(2)}; misma salida UART: ${res.same ? "sí" : "NO"}`);
}
