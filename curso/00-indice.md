# Linux en una pestaña: el curso

Un emulador RISC-V de 32 bits (RV32IMA, modos M y U) escrito desde cero en TypeScript que arranca Linux 6.1 sin MMU hasta una shell, en la terminal con Node y en el navegador. Este curso lo recorre pieza a pieza, en el mismo orden en que se construyó: cada capítulo enlaza al código que explica y termina con un ejercicio que se comprueba con las pruebas del propio repositorio.

## Antes de empezar

```bash
./setup.sh                 # compila riscv-tests, baja la imagen de Linux y empaqueta la web
./score                    # comprueba todos los peldaños (R0..R6)
node node/run.ts --stats   # Linux en la terminal (usuario root, sin contraseña; Ctrl-A x sale)
node web/test.mjs          # la versión web, probada en Chromium con Playwright
```

Para la página: `node web/build.mjs` y sirve `web/dist/` con cualquier servidor estático (abrir `index.html` como fichero no basta: el worker y la imagen se bajan con `fetch`).

## Capítulos

1. [El procesador como bucle](01-el-procesador-como-bucle.md): leer, decodificar, ejecutar, repetir.
2. [Decodificación](02-decodificacion.md): de 32 bits a una orden; formatos e inmediatos.
3. [La ALU y la extensión M](03-alu-y-extension-m.md): aritmética de 32 bits en JavaScript, multiplicar y dividir.
4. [Memoria y E/S](04-memoria-y-es.md): RAM, bus y dispositivos mapeados en memoria.
5. [CSR y traps](05-csr-y-traps.md): registros de control, excepciones, interrupciones y atómicas.
6. [Dispositivos y device tree](06-dispositivos-y-device-tree.md): UART, CLINT, syscon y cómo se los describimos a Linux.
7. [Arrancar Linux](07-arrancar-linux.md): de la primera instrucción del kernel a la shell, en Node y en la web.
8. [Rendimiento](08-rendimiento.md): medir MIPS y dónde se va el tiempo.

## Mapa del código

| Fichero | Qué hay | Capítulos |
|---|---|---|
| [`src/cpu.ts`](../src/cpu.ts) | el hart: registros, decodificación, ALU, CSR, traps, atómicas | 1, 2, 3, 5, 8 |
| [`src/bus.ts`](../src/bus.ts) | RAM y ruta lenta hacia los dispositivos | 4 |
| [`src/devices.ts`](../src/devices.ts) | UART 16550, CLINT, syscon | 6 |
| [`src/dtb.ts`](../src/dtb.ts) | generador de device tree binario | 6 |
| [`src/machine.ts`](../src/machine.ts) | la máquina completa y su mapa de memoria | 1, 4, 6, 7 |
| [`node/run.ts`](../node/run.ts) | Linux en la terminal | 7, 8 |
| [`web/worker.ts`](../web/worker.ts), [`web/main.ts`](../web/main.ts) | Linux en el navegador | 7, 8 |
| [`tests/riscv-tests/run.ts`](../tests/riscv-tests/run.ts) | ejecuta los riscv-tests oficiales | 1–5 |
| [`tools/score.ts`](../tools/score.ts) | la puntuación del reto | todos |

Siguiente: [1. El procesador como bucle](01-el-procesador-como-bucle.md)
