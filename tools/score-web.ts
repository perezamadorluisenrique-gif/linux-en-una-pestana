// Peldaño R5: empaqueta web/ (si hace falta) y ejecuta la prueba de Playwright de web/test.mjs.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const WEB = join(ROOT, "web");
type Check = { rung: string; ok: boolean; detail: string };

export async function webChecks(): Promise<Check[]> {
  try {
    if (!existsSync(join(WEB, "node_modules"))) execFileSync("npm", ["ci", "--silent"], { cwd: WEB, stdio: "inherit" });
    execFileSync(process.execPath, [join(WEB, "build.mjs")], { stdio: "ignore" });
    const { webCheck } = await import(join(WEB, "test.mjs"));
    const r = await webCheck();
    return [{ rung: "R5", ok: r.ok, detail: r.detail }];
  } catch (e) {
    return [{ rung: "R5", ok: false, detail: `la prueba web falla: ${(e as Error).message.split("\n")[0]}` }];
  }
}
