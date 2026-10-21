# 6. Dispositivos y device tree

Una CPU sola no sirve de mucho: necesita una forma de hablar con el mundo. En el capítulo 4 vimos que el [`Bus`](../src/bus.ts) reparte las direcciones entre la RAM y los dispositivos. Este capítulo los construye: una UART para el teclado y la pantalla, un temporizador y un interruptor de apagado. Y después resuelve un problema curioso: ¿cómo se entera Linux de que existen, y en qué direcciones?

## Un dispositivo es un puñado de registros

Todos los dispositivos implementan la interfaz `Device` de [`bus.ts`](../src/bus.ts): un `base`, un `size` y dos métodos, `read(offset, width)` y `write(offset, value, width)`. Desde el punto de vista de un programa, leer la dirección `0x10000005` no es leer memoria: es preguntarle a la UART "¿cómo estás?". Lo que ocurra dentro es cosa del dispositivo. Esto se llama E/S mapeada en memoria.

## La UART 16550

La UART (Universal Asynchronous Receiver-Transmitter) es el puerto serie. Elegimos el modelo 16550 porque Linux ya tiene driver para él (el 8250) y lo conoce de memoria. [`Uart16550`](../src/devices.ts) expone ocho registros de un byte. Los esenciales:

| Offset | Lectura | Escritura |
|---|---|---|
| 0 | RBR: siguiente byte recibido | THR: byte a transmitir |
| 1 | IER | IER: qué interrupciones se piden |
| 2 | IIR: qué interrupción hay pendiente | FCR: control de la FIFO |
| 5 | LSR: estado de línea | |

Transmitir es sencillo: escribir en el offset 0 llama a `onTransmit(byte)`, un callback que la máquina conecta a la pantalla (en Node, `process.stdout.write`; en la web, un buffer que viaja al hilo principal). Recibir es meter bytes en una cola con `receive()` y dejar que el driver los lea del offset 0. El registro LSR dice si hay dato (bit 0, DR) y si se puede transmitir (bits THRE y TEMT, `0x60`):

```ts
case 5: // LSR: THRE y TEMT siempre (transmitimos al instante); DR si hay datos
  return 0x60 | (this.rx.length ? 0x01 : 0);
```

### Por qué IIR tiene que decir THRE

Este es el detalle que más problemas dio. La UART anuncia al kernel un transmisor con FIFO de 16 bytes (`compatible = "ns16550a"`). El driver 8250 de Linux envía caracteres en tandas y, tras llenar la FIFO, espera a que el hardware avise de que el transmisor está vacío (THRE) para mandar más. Esa noticia llega por el registro **IIR**. Si IIR siempre responde "no hay nada pendiente", el driver nunca recibe el aviso y la consola se queda congelada justo después de 16 caracteres: el diario del proyecto (`PROGRESS.md`) lo anota. La solución está en las líneas del IIR:

```ts
if ((this.ier & 2) && this.threPending) {
  this.threPending = false; // leer IIR "consume" la interrupción de THR vacío
  return fifo | 0x02;
}
return fifo | 0x01; // ninguna
```

Cada byte transmitido pone `threPending = true`, y habilitar la interrupción de THR en IER la dispara al instante, porque nuestro transmisor está siempre libre. Leer IIR la consume, igual que en el chip real. La lección general: los emuladores no tienen que modelar todo el hardware, pero sí todo aquello **que el software sondea**.

## El CLINT: el reloj de Linux

El CLINT (Core Local Interruptor, de SiFive) aporta el tiempo y dos interrupciones. [`Clint`](../src/devices.ts) tiene tres piezas:

- **mtime** (offset `0xbff8`): contador de 64 bits que sube solo. Aquí cuenta microsegundos (`TIMEBASE = 1_000_000`), y no se almacena: `read` llama a `now()`, el reloj de la máquina.
- **mtimecmp** (`0x4000`): el despertador. Cuando `mtime >= mtimecmp`, se activa la interrupción de temporizador.
- **msip** (`0x0000`): un bit que el software escribe para interrumpirse a sí mismo.

Los registros de 64 bits se leen y escriben en dos mitades de 32, porque el bus es de 32 bits. Por eso `write` reconstruye `mtimecmp` con `Math.floor(... / 4294967296)` en vez de usar operaciones de bits: un `number` de JavaScript guarda con exactitud enteros de hasta 2^53, de sobra, pero los operadores `|` y `&` los truncan a 32 bits.

Quien traduce ese estado en una interrupción es [`Machine.updateInterrupts`](../src/machine.ts), que se ejecuta entre tramos de instrucciones:

```ts
let mip = cpu.mip & ~((1 << IRQ.MTI) | (1 << IRQ.MSI));
if (this.clock() >= this.clint.mtimecmp) mip |= 1 << IRQ.MTI;
if (this.clint.msip) mip |= 1 << IRQ.MSI;
cpu.mip = mip;
```

La CPU no sabe que existe un CLINT; solo ve bits en `mip`. El kernel programa el próximo "tic" escribiendo `mtimecmp`, la línea sube cuando llega la hora, y el trap del capítulo 5 hace el resto.

## Syscon: botón de apagado

[`Syscon`](../src/devices.ts) es el dispositivo más pequeño: un registro. Si el software escribe `0x5555` la máquina se apaga, con `0x7777` se reinicia. La máquina conecta `onPower` y `Machine.step` deja de ejecutar cuando `power` deja de ser `"running"`. Es lo que ocurre cuando escribes `poweroff` en la shell.

## El device tree: cómo se entera Linux

En un PC, el kernel descubre el hardware preguntando (PCI, ACPI). En una placa pequeña no hay a quién preguntar, así que el firmware entrega un **device tree**: un árbol de nodos y propiedades que dice "hay 64 MB de RAM en tal sitio, una UART compatible con `ns16550a` aquí, un CLINT allí". [`Machine.describe`](../src/machine.ts) lo escribe a mano como un objeto de TypeScript, y fíjate en cómo se parece a un fichero `.dts`:

```ts
[`serial@${UART_BASE.toString(16)}`]: {
  props: { compatible: "ns16550a", reg: reg64(UART_BASE, 0x100), "clock-frequency": 0x1000000 },
},
[`clint@${CLINT_BASE.toString(16)}`]: {
  props: {
    compatible: ["sifive,clint0", "riscv,clint0"], reg: reg64(CLINT_BASE, 0x10000),
    "interrupts-extended": [2, IRQ.MSI, 2, IRQ.MTI],
  },
},
```

El `compatible` es el que enlaza con el driver: Linux busca uno que declare entender `ns16550a`. Las direcciones salen de las mismas constantes (`UART_BASE`, `CLINT_BASE`) que usa el `Bus`, de modo que el árbol y el hardware no pueden desincronizarse. `timebase-frequency` informa de que `mtime` va a 1 MHz; `riscv,isa` es `rv32ima`; `mmu-type` es `riscv,none`. Los nodos `syscon-poweroff` y `syscon-reboot` conectan `poweroff` de la shell con el registro del syscon.

## El generador DTB

Linux no lee texto, lee el formato binario **FDT**. [`buildDtb`](../src/dtb.ts) lo genera sin ninguna herramienta externa. El formato tiene tres partes pegadas en un solo buffer:

1. **Cabecera** de 40 bytes: el número mágico `0xd00dfeed`, el tamaño total, y los desplazamientos de las otras partes. Todo en big-endian, al contrario que el resto de RISC-V.
2. **Bloque de estructura**: una secuencia de palabras de 32 bits con marcas (`FDT_BEGIN_NODE`, `FDT_PROP`, `FDT_END_NODE`, `FDT_END`). Cada propiedad lleva su longitud y el desplazamiento de su nombre.
3. **Bloque de cadenas**: los nombres de propiedad, sin repetir. La función `nameOffset` guarda cada nombre una vez y reutiliza su posición con un `Map`.

Hay que rellenar a múltiplos de 4 tras cada nombre y cada valor (`while (struct.length % 4) struct.push(0)`), porque el parser de Linux lo espera. Una cabecera mal calculada produce el peor tipo de fallo: el kernel arranca y no dice nada.

## Ejercicio

Añade un dispositivo nuevo: `Led` en `0x11200000` con un registro que guarde el último byte escrito, y descríbelo en el device tree como `led@11200000` con `compatible = "pestana,led"`.

Cómo comprobarlo: (1) con un test en Node que escriba en esa dirección con `machine.bus.writeIO` y lea el valor de vuelta; (2) con `buildDtb` aparte: genera el árbol, comprueba que los primeros 4 bytes valen `0xd00dfeed` y que la cadena `pestana,led` aparece en el buffer. (3) Arranca Linux con `node node/run.ts` y comprueba que sigue llegando al login; al final lanza `./score`.

Pista: copia la forma de [`Syscon`](../src/devices.ts), que ya es un dispositivo de un solo registro, y no olvides `this.bus.attach(...)` en el constructor de `Machine`.

Anterior: [05-csr-y-traps.md](05-csr-y-traps.md) · Siguiente: [07-arrancar-linux.md](07-arrancar-linux.md)
