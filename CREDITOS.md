# Créditos y licencias

El emulador (`src/`, `node/`, `tools/`, `tests/*.ts`) está escrito desde cero para este proyecto. No contiene código de otros emuladores.

## Lo que se usa de terceros (no está en el repositorio: lo baja `setup.sh`)

| Qué | De dónde | Licencia | Uso |
|---|---|---|---|
| riscv-tests | https://github.com/riscv-software-src/riscv-tests (commit `3df703cd`) | BSD-3-Clause, © The Regents of the University of California | Se compilan con clang para comprobar la CPU (`tests/riscv-tests/build.sh`). |
| riscv-test-env | https://github.com/riscv/riscv-test-env (commit `a1c373ec`) | BSD-3-Clause, © The Regents of the University of California | Entorno "p" de los tests (arranque, `tohost`, `link.ld`). |
| Imagen de Linux nommu `linux-6.1.14-rv32nommu-cnl-1` | https://github.com/cnlohr/mini-rv32ima-images (commit `7da8c6e4`, fichero `images/linux-6.1.14-rv32nommu-cnl-1.zip`) | El repositorio es GPL-3.0; el kernel Linux es GPL-2.0; busybox (dentro del initramfs) es GPL-2.0 | Es el sistema que arranca el emulador. |
| xterm.js (`@xterm/xterm` 6.0.0) | https://github.com/xtermjs/xterm.js (npm) | MIT, © The xterm.js authors | Terminal de la página web; esbuild la empaqueta en `web/dist/main.js` (sin CDN). |
| esbuild 0.25.10 | https://github.com/evanw/esbuild (npm) | MIT, © Evan Wallace | Solo para empaquetar `web/`. |
| Playwright (instalado en la sesión) | https://github.com/microsoft/playwright | Apache-2.0 | Solo para la prueba de `web/test.mjs`. |
| Mapa de memoria de mini-rv32ima | https://github.com/cnlohr/mini-rv32ima (`mini-rv32ima/sixtyfourmb.dts`) | MIT, © 2022 CNLohr | Solo como información: direcciones de RAM, UART, CLINT y syscon que espera la imagen. El device tree de `src/machine.ts` está escrito a mano. |

## Fuentes de la imagen de Linux (GPL)

- Kernel: Linux 6.1.14, https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.1.14.tar.xz
- Configuración del kernel, busybox, uclibc y buildroot usadas por cnlohr: https://github.com/cnlohr/mini-rv32ima/tree/master/configs
- Buildroot de cnlohr: https://github.com/cnlohr/buildroot

## Especificaciones consultadas

- The RISC-V Instruction Set Manual, volúmenes I (no privilegiado) y II (privilegiado): https://github.com/riscv/riscv-isa-manual
- Devicetree Specification v0.4: https://www.devicetree.org/specifications/
- WebAssembly Core Specification 1.0 (formato binario y códigos de operación, para `src/wasm.ts` y `src/fast.ts`): https://webassembly.github.io/spec/core/
- Hoja de datos del UART 16550 (registros IER, IIR, LCR, LSR).
- SiFive CLINT (mtime/mtimecmp/msip), tal como lo describe la documentación del kernel (`Documentation/devicetree/bindings/timer/sifive,clint.yaml`).
