// Peldaño R7 (variante rendimiento): el doble de MIPS que la CPU de partida, medido en la misma
// máquina y en el mismo proceso (tools/perf/bench.ts), y con el mismo texto de arranque.
import { compare } from "./perf/bench.ts";

type Check = { rung: string; ok: boolean; detail: string };
const TARGET = 2.0;

export function perfChecks(): Check[] {
  const r = compare();
  const ok = r.same && r.ratio >= TARGET;
  return [{
    rung: "R7", ok,
    detail: `rendimiento x${r.ratio.toFixed(2)} (objetivo x${TARGET}): ${r.cur.toFixed(1)} MIPS frente a ` +
      `${r.base.toFixed(1)} de la CPU de partida, ${r.n / 1e6} M instr. del arranque` +
      (r.same ? "" : "; la salida del arranque NO coincide"),
  }];
}
