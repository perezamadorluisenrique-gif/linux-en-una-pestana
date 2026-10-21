# Linux en una pestaña

Un emulador RISC-V de 32 bits (RV32IMA, modos M y U) escrito desde cero en TypeScript que arranca
**Linux 6.1 sin MMU hasta una shell**, en la terminal con Node y en el navegador, y un **curso en
español de ocho capítulos** que lo explica pieza a pieza.

- **Pruébalo:** la página web (GitHub Pages) arranca Linux en un Web Worker con xterm.js. Usuario `root`, sin contraseña.
- **Léelo:** el curso empieza en [`curso/00-indice.md`](curso/00-indice.md) (en la web, `curso/`).

## Qué hay

| Carpeta | Contenido |
|---|---|
| `src/` | la CPU (`cpu.ts`), el motor rápido en WebAssembly generado desde TypeScript (`fast.ts`, `wasm.ts`), bus, dispositivos, device tree, cargador ELF |
| `node/run.ts` | Linux en la terminal |
| `web/` | la página original del emulador (`main.ts`, `worker.ts`, `build.mjs`, `test.mjs`) |
| `curso/` | el curso, en Markdown |
| `tests/`, `tools/`, `score` | 76 riscv-tests con los dos motores, arranque de Linux, web, curso y rendimiento |
| `sitio/`, `herramientas/`, `pruebas/` | el sitio web publicado (portada + curso en HTML) y sus pruebas |

## Uso

Requisitos: Node ≥ 22.18 (ejecuta `.ts` directamente), git y unzip. Para los riscv-tests, además clang y ld.lld.

```bash
npm ci
npm run imagen               # baja la imagen de Linux (GPL) y comprueba su SHA-256
npm run build                # construye _site/: portada con el emulador + curso en HTML
npm test                     # Playwright: arranca hasta la shell y ejecuta uname -a; axe-core en todas las páginas
python3 -m http.server -d _site 8000   # y abre http://localhost:8000

node node/run.ts --stats     # Linux en la terminal (Ctrl-A x sale)
./setup.sh && ./score        # todas las pruebas del emulador (compila los riscv-tests)
```

Abrir `index.html` como fichero no basta: el worker y la imagen se cargan con `fetch`, hace falta un servidor.

El workflow `.github/workflows/pages.yml` construye y prueba el sitio y lo publica en GitHub Pages
(Settings → Pages → Source: «GitHub Actions»).

## Licencias

Código MIT, curso CC BY 4.0, imagen de Linux GPL (no incluida; se descarga). Ver [LICENSE.md](LICENSE.md) y [CREDITOS.md](CREDITOS.md).

## In English

*Linux in a tab*: a 32-bit RISC-V emulator (RV32IMA, M and U modes) written from scratch in
TypeScript that boots Linux 6.1 (nommu) to a shell, both in Node and in the browser (Web Worker +
xterm.js), plus an eight-chapter course in Spanish that walks through it piece by piece: the
fetch-decode-execute loop, decoding, the ALU and the M extension, memory and MMIO, CSRs and traps,
devices and the device tree, booting Linux, and performance (a WebAssembly fast path generated from
TypeScript, ~2.4× faster than the plain interpreter).

The page also has an English version at `/en/` (https://perezamadorluisenrique-gif.github.io/linux-en-una-pestana/en/), with the same emulator; the course is in Spanish.

`npm ci && npm run imagen && npm run build && npm test` builds the website into `_site/` and tests
it (Playwright boots Linux and runs `uname -a`; axe-core checks accessibility). Code is MIT, the
course text is CC BY 4.0, and the Linux image (GPL) is downloaded at build time, not stored here.
