// Peldaños R3 y R4: arranca node/run.ts como lo usaría una persona (stdin/stdout por tubería),
// espera el arranque, entra como root, ejecuta `uname -a` y `ls /` y comprueba la salida.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
type Check = { rung: string; ok: boolean; detail: string };

// deno-lint-ignore no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");

export async function linuxChecks(): Promise<Check[]> {
  const image = join(ROOT, "build/linux/Image");
  if (!existsSync(image)) {
    return [{ rung: "R3", ok: false, detail: "falta build/linux/Image (ejecuta ./setup.sh)" }];
  }
  const child = spawn(process.execPath, [join(ROOT, "node/run.ts"), "--stats"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d.toString("latin1"); });
  child.stderr.on("data", (d) => { err += d.toString(); });
  const t0 = performance.now();
  const secs = () => ((performance.now() - t0) / 1000).toFixed(2);

  /** Espera a que la salida (a partir de `from`) cumpla `re`. Devuelve el índice tras la coincidencia. */
  const waitFor = (re: RegExp, from: number, timeoutMs: number): Promise<number> =>
    new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        const m = re.exec(out.slice(from));
        if (m) return resolve(from + m.index + m[0].length);
        if (performance.now() - start > timeoutMs || child.exitCode !== null) return resolve(-1);
        setTimeout(tick, 20);
      };
      tick();
    });
  const send = (s: string) => child.stdin.write(s);

  const checks: Check[] = [];
  try {
    let p = await waitFor(/Run \/init as init process/, 0, 120_000);
    const banner = /Linux version 6\.1\.14/.test(out);
    const tInit = secs();
    checks.push({
      rung: "R3", ok: p >= 0 && banner,
      detail: p >= 0 ? `el kernel arranca por la UART y lanza /init en ${tInit} s` : "no llega a /init en 120 s",
    });
    if (p < 0) return checks;

    p = await waitFor(/login: $/, p, 60_000);
    const tLogin = secs();
    let ok = p >= 0;
    let detail = ok ? `login en ${tLogin} s` : "no aparece el login";
    if (ok) {
      send("root\n");
      p = await waitFor(/# $/, p, 30_000);
      const mark1 = p;
      send("uname -a\n");
      p = await waitFor(/# $/, p, 30_000);
      const uname = stripAnsi(out.slice(mark1, p));
      const unameOk = /Linux buildroot 6\.1\.14 .*riscv32 GNU\/Linux/.test(uname);
      const mark2 = p;
      send("ls /\n");
      p = await waitFor(/# $/, p, 30_000);
      const ls = stripAnsi(out.slice(mark2, p)).split(/\s+/);
      const lsOk = ["bin", "dev", "etc", "proc", "sys", "usr", "tmp"].every((d) => ls.includes(d));
      ok = unameOk && lsOk;
      detail += `; uname -a ${unameOk ? "OK" : "MAL"}; ls / ${lsOk ? "OK" : "MAL"}`;
      send("poweroff\n");
      await new Promise<void>((r) => {
        const t = setTimeout(() => { child.kill(); r(); }, 30_000);
        child.on("exit", () => { clearTimeout(t); r(); });
      });
      const st = /\[stats\] instrucciones=(\d+) .*MIPS=([\d.]+)/.exec(err);
      if (st) detail += `; ${st[2]} MIPS (${(Number(st[1]) / 1e6).toFixed(0)} M instr. hasta apagar)`;
    }
    checks.push({ rung: "R4", ok, detail });
    return checks;
  } finally {
    if (child.exitCode === null) child.kill();
  }
}
