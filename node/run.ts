// Arranca Linux en la terminal. Uso:
//   node node/run.ts [build/linux/Image] [--stats]
// Ctrl-A x sale. Con --stats imprime al salir las instrucciones ejecutadas y los MIPS.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Machine } from "../src/machine.ts";

const args = process.argv.slice(2);
const stats = args.includes("--stats");
const image = args.find((a) => !a.startsWith("--")) ?? join(import.meta.dirname, "../build/linux/Image");

const m = new Machine();
m.loadKernel(readFileSync(image));
m.uart.onTransmit = (b) => process.stdout.write(Uint8Array.of(b));

const t0 = performance.now();
let busyMs = 0; // tiempo dentro del emulador (sin contar las esperas de WFI)
let ctrlA = false;
function finish(code: number): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  if (stats) {
    const s = (performance.now() - t0) / 1000;
    const n = m.cpu.instret;
    process.stderr.write(`\n[stats] instrucciones=${n} segundos=${s.toFixed(2)} ` +
      `ocupado=${(busyMs / 1000).toFixed(2)} MIPS=${(n / busyMs / 1000).toFixed(1)}\n`);
  }
  process.exit(code);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", (d: Buffer) => {
  for (const b of d) {
    if (ctrlA && b === 0x78) finish(0); // Ctrl-A x
    ctrlA = b === 0x01;
  }
  m.uart.receive(d);
});
process.stdin.on("end", () => {}); // sin stdin (tubería cerrada) seguimos corriendo

function loop(): void {
  const t = performance.now();
  const idle = m.step(5_000_000);
  busyMs += performance.now() - t;
  if (m.power !== "running") { process.stderr.write(`\n[${m.power}]\n`); finish(0); return; }
  if (idle > 0) setTimeout(loop, Math.max(1, Math.floor(idle / 1000)));
  else setImmediate(loop);
}
loop();
