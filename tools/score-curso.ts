// Peldaño R6: el curso en curso/. Comprueba al menos 7 capítulos (NN-*.md), cada uno con
// enlaces relativos a ficheros de código que existen (al menos uno a ../src/), una sección
// "## Ejercicio" y una extensión mínima; y que no haya enlaces rotos a ficheros locales.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const CURSO = join(ROOT, "curso");
type Check = { rung: string; ok: boolean; detail: string };

export function cursoChecks(): Check[] {
  if (!existsSync(CURSO)) return [{ rung: "R6", ok: false, detail: "falta curso/" }];
  const chapters = readdirSync(CURSO).filter((f) => /^(0[1-9]|[1-9]\d)-.*\.md$/.test(f)).sort();
  const problems: string[] = [];
  for (const f of chapters) {
    const text = readFileSync(join(CURSO, f), "utf8");
    const links = [...text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)].map((m) => m[1]).filter((l) => !/^[a-z]+:/.test(l));
    const broken = links.filter((l) => !existsSync(join(dirname(join(CURSO, f)), l)));
    if (!links.some((l) => l.startsWith("../src/"))) problems.push(`${f}: sin enlace a ../src/`);
    if (broken.length) problems.push(`${f}: enlaces rotos ${broken.join(", ")}`);
    if (!/^## Ejercicio/m.test(text)) problems.push(`${f}: sin "## Ejercicio"`);
    if (text.split(/\s+/).length < 600) problems.push(`${f}: menos de 600 palabras`);
  }
  const ok = chapters.length >= 7 && problems.length === 0;
  return [{
    rung: "R6", ok,
    detail: `${chapters.length} capítulos` + (problems.length ? `; ${problems.slice(0, 4).join("; ")}` : "; enlaces al código y ejercicios OK"),
  }];
}
