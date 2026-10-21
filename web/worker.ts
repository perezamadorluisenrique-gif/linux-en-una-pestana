// El emulador en un Web Worker: la página solo pinta la terminal y el bucle no la bloquea.
// Mensajes: entra {type:"key", data: Uint8Array}; sale {type:"out", data}, {type:"stats", ...}, {type:"power", ...}.
import { Machine } from "../src/machine.ts";

const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(msg, transfer);

let m: Machine | null = null;
let outBuf: number[] = [];
let busyMs = 0;

function flush(): void {
  if (outBuf.length === 0) return;
  const data = Uint8Array.from(outBuf);
  outBuf = [];
  post({ type: "out", data }, [data.buffer]);
}

function loop(): void {
  if (!m) return;
  // Tramo de ~16 ms: lo justo para no retrasar las teclas ni la salida.
  const t = performance.now();
  let idle = 0;
  while (performance.now() - t < 16) {
    idle = m.step(200_000);
    if (idle > 0 || m.power !== "running") break;
  }
  busyMs += performance.now() - t;
  flush();
  if (m.power !== "running") { post({ type: "power", state: m.power }); return; }
  if (idle > 0) setTimeout(loop, Math.max(1, Math.min(16, Math.floor(idle / 1000))));
  else setTimeout(loop, 0);
}

setInterval(() => {
  if (m) post({ type: "stats", instret: m.cpu.instret, busyMs });
}, 1000);

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "boot") {
    const res = await fetch(msg.url ?? "Image");
    if (!res.ok) { post({ type: "error", message: `no se pudo bajar la imagen (${res.status})` }); return; }
    const image = new Uint8Array(await res.arrayBuffer());
    m = new Machine();
    m.uart.onTransmit = (b) => { outBuf.push(b); };
    m.loadKernel(image);
    post({ type: "booting", bytes: image.length });
    loop();
  } else if (msg.type === "key" && m) {
    m.uart.receive(msg.data as Uint8Array);
  }
};
