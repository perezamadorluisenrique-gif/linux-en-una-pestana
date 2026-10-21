# 7. Arrancar Linux

Tenemos una CPU que supera los tests oficiales, una RAM, una UART, un temporizador y un árbol de dispositivos. Falta lo que da sentido a todo: encender la máquina y ver aparecer `login:`. Este capítulo cuenta cómo se pasa del "emulador que pasa tests" al "emulador que arranca un sistema operativo de verdad", en la terminal y en el navegador.

## Qué estamos arrancando

No compilamos nuestro propio kernel. Usamos la imagen `linux-6.1.14-rv32nommu-cnl-1` del proyecto mini-rv32ima de CNLohr, que está documentada con sus licencias en [`CREDITOS.md`](../CREDITOS.md). Es un Linux 6.1.14 configurado **sin MMU** (nommu) y con un initramfs de buildroot que incluye busybox. `./setup.sh` la descarga; no vive en el repositorio.

Sin MMU significa que no hay traducción de direcciones: los procesos comparten el espacio de direcciones físico y el kernel confía en que se porten bien. Para nosotros es una bendición: implementar una MMU (tablas de páginas, TLB) habría doblado el tamaño de la CPU. Y por eso basta con los modos M y U del capítulo 5.

La imagen es un fichero plano: un `Image` que se copia tal cual al principio de la RAM y se ejecuta desde su primer byte. No hay cargador, ni ELF, ni nada de eso.

## Machine.loadKernel y la convención de arranque

Toda la ceremonia cabe en [`loadKernel`](../src/machine.ts):

```ts
loadKernel(image: Uint8Array): void {
  this.bus.load(RAM_BASE, image);
  this.cpu.reset(RAM_BASE);
  // Convención de arranque de RISC-V Linux: a0 = id del hart, a1 = dirección del DTB.
  this.cpu.x[10] = 0;
  this.cpu.x[11] = this.dtbAddr;
}
```

Tres pasos: copiar el kernel a `0x80000000`, poner el `pc` ahí y rellenar dos registros. `a0` (x10) es el identificador del hart; `a1` (x11) es la dirección del device tree. Es el único contrato entre el firmware y Linux: ni cabeceras, ni llamadas, solo dos registros. El DTB lo dejó el constructor de `Machine` al final de la RAM, en una reserva de 16 KiB, y la memoria que anunciamos al kernel termina justo antes, para que Linux no pise su propio árbol.

## bootargs y earlycon

Dentro del árbol, el nodo `chosen` lleva la **línea de comandos**:

```
earlycon=uart8250,mmio,0x10000000,1000000 console=ttyS0
```

`earlycon` le dice al kernel que escriba en esa dirección de memoria mediante un driver mínimo desde el primer instante, antes de haber inicializado ningún dispositivo. Sin él no ves nada de lo que ocurre antes de que el driver 8250 se registre, y depurar un arranque a ciegas es una pesadilla. `console=ttyS0` elige la consola definitiva, que luego usará el driver completo que vimos en el capítulo 6.

## Qué pasa hasta "Run /init"

Si arrancas el programa verás, con marcas de tiempo del kernel, algo como esto (recortado):

```
[    0.000000] Linux version 6.1.14 (cnlohr@cnlohr-1520) ...
[    0.000000] earlycon: uart8250 at MMIO 0x10000000 (options '1000000')
[    0.000000] Kernel command line: earlycon=uart8250,mmio,0x10000000,1000000 console=ttyS0
...
[    0.399599] Run /init as init process
buildroot login:
```

En orden: el kernel lee el DTB y averigua cuánta RAM hay; programa el temporizador escribiendo `mtimecmp` (aquí interviene el CLINT); registra el driver de la UART; descomprime el initramfs en RAM; y lanza `/init`, el primer programa en modo usuario. A partir de ahí, busybox y su `login` hacen el resto. Cuando entras como `root`, la shell te devuelve un `#`. En este entorno `./score` midió el arranque hasta `/init` en menos de un segundo y el login en torno a un segundo, pero las cifras dependen del ordenador.

## En la terminal: node/run.ts

[`node/run.ts`](../node/run.ts) son unas 50 líneas que conectan la máquina con el sistema operativo anfitrión. Dos cables: la salida de la UART va a `process.stdout.write`, y la entrada de `process.stdin` se entrega a `m.uart.receive`. Si stdin es una terminal real, lo pone en **modo raw**:

```ts
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("data", (d: Buffer) => {
  for (const b of d) {
    if (ctrlA && b === 0x78) finish(0); // Ctrl-A x
    ctrlA = b === 0x01;
  }
  m.uart.receive(d);
});
```

El modo raw es imprescindible: en el modo normal el sistema anfitrión espera a que pulses Enter, procesa Ctrl-C por su cuenta y hace eco de lo que escribes. Pero Linux ya hace su propio eco y quiere cada tecla en cuanto se pulsa. La salida con **Ctrl-A x** (la convención de QEMU) es necesaria precisamente porque Ctrl-C ahora es un byte más que pertenece al guest.

El bucle `loop()` llama a `m.step(5_000_000)`. Si devuelve un tiempo de espera (la CPU en WFI), se reprograma con `setTimeout`; si no, con `setImmediate`, para que Node atienda el teclado entre medias.

## En el navegador: Web Worker y xterm.js

En una página, un bucle largo bloquearía la interfaz. La solución estándar es un **Web Worker**, un hilo aparte. [`web/worker.ts`](../web/worker.ts) contiene la máquina; [`web/main.ts`](../web/main.ts) pinta la terminal con xterm.js y reenvía las teclas. Se hablan con mensajes (`key`, `out`, `stats`, `power`). El worker descarga la `Image` con `fetch`, crea la `Machine` y conecta la UART a un buffer de salida que vacía en bloque cada tramo, porque enviar un mensaje por carácter sería carísimo. [`web/build.mjs`](../web/build.mjs) usa esbuild para empaquetar `main.js` y `worker.js` y copia la imagen a `web/dist`. Nada se descarga de un CDN.

## Cómo se comprueba

Dos programas arrancan el sistema como lo haría una persona. [`tools/score-linux.ts`](../tools/score-linux.ts) lanza `node/run.ts` como proceso hijo, escribe en su stdin y espera con expresiones regulares: primero `Run /init as init process`, luego `login: `, envía `root`, espera el `# `, ejecuta `uname -a` y `ls /` y comprueba el resultado. [`web/test.mjs`](../web/test.mjs) hace lo mismo con Chromium controlado por Playwright: sirve `web/dist`, abre la página con `?autoboot`, lee el buffer de xterm.js y teclea. Ambas pruebas son de **extremo a extremo**: si fallan, no importa qué módulo falló, sabes que el sistema no arranca.

## Ejercicio

Cambia los `bootargs` para que Linux muestre más información: añade `loglevel=8` o `debug` a la línea de comandos que `Machine` usa por defecto (o pásala con la opción `bootargs` de `MachineOptions`).

Cómo comprobarlo: ejecuta `(sleep 3; printf 'root\nuname -a\npoweroff\n') | node node/run.ts --stats` antes y después, y compara con `diff` la cantidad de líneas del arranque. Después ejecuta `./score`: R3 y R4 deben seguir en verde. Pregúntate además qué pasa si quitas `earlycon`: ¿a partir de qué línea desaparecen los mensajes?

Pista: `bootargs` se pasa a `describe()` desde el constructor de [`Machine`](../src/machine.ts); no hace falta tocar el generador DTB, porque `chosen/bootargs` es solo una propiedad de tipo cadena.

Anterior: [06-dispositivos-y-device-tree.md](06-dispositivos-y-device-tree.md) · Siguiente: [08-rendimiento.md](08-rendimiento.md)
