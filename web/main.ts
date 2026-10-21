// La página: xterm.js como terminal y un Web Worker con la máquina RISC-V (worker.ts).
import { Terminal } from "@xterm/xterm";

const term = new Terminal({ convertEol: false, cursorBlink: true, fontSize: 14, scrollback: 5000 });
term.open(document.getElementById("term")!);
// Para la prueba de Playwright (y para curiosear desde la consola).
(window as unknown as { term: Terminal }).term = term;

const status = document.getElementById("status")!;
const button = document.getElementById("boot") as HTMLButtonElement;
const enc = new TextEncoder();
let worker: Worker | null = null;
let lastInstret = 0, lastBusy = 0;

function boot(): void {
  if (worker) worker.terminate();
  term.reset();
  lastInstret = 0; lastBusy = 0;
  worker = new Worker("worker.js");
  worker.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    if (msg.type === "out") term.write(msg.data as Uint8Array);
    else if (msg.type === "booting") status.textContent = `arrancando (${(msg.bytes / 1e6).toFixed(1)} MB de imagen)…`;
    else if (msg.type === "stats") {
      const di = msg.instret - lastInstret, db = msg.busyMs - lastBusy;
      lastInstret = msg.instret; lastBusy = msg.busyMs;
      const mips = db > 0 ? (di / db / 1000).toFixed(1) : "0.0";
      status.textContent = `${(msg.instret / 1e6).toFixed(0)} M instrucciones · ${mips} MIPS`;
    } else if (msg.type === "power") status.textContent = `máquina: ${msg.state}`;
    else if (msg.type === "error") status.textContent = msg.message;
  };
  worker.postMessage({ type: "boot", url: "Image" });
  term.focus();
}

term.onData((s) => { worker?.postMessage({ type: "key", data: enc.encode(s) }); });
button.addEventListener("click", boot);
if (new URLSearchParams(location.search).has("autoboot")) boot();
