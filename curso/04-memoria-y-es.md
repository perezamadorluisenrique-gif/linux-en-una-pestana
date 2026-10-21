# 4. Memoria y entrada/salida

Una CPU sin memoria solo puede jugar con sus 32 registros. Para ejecutar Linux hace falta guardar el kernel, los datos y la pila, y además hablar con el mundo exterior: escribir en una consola, leer el reloj, apagar la máquina. RISC-V resuelve todo con una sola idea: **todo es una dirección**. Este capítulo explica cómo.

## La RAM es un ArrayBuffer

La memoria principal de nuestro emulador es un `Uint8Array` con un `DataView` encima, ambos sobre el mismo buffer, en el constructor de [`Bus`](../src/bus.ts). Ese buffer es la memoria lineal de un `WebAssembly.Memory` (o un `ArrayBuffer` normal si no existe `WebAssembly`), con `EXTRA_BYTES` de más tras la RAM para los registros y el estado del motor rápido:

```ts
this.ram = new Uint8Array(buffer, 0, ramSize);
this.view = new DataView(buffer);
```

El `Uint8Array` sirve para acceder byte a byte. El `DataView` tiene métodos como `getInt32(offset, littleEndian)` que leen enteros de varios bytes, en cualquier alineación y con el orden de bytes que se pida. Como la RAM está en la memoria de WebAssembly, el motor rápido del capítulo 8 lee y escribe exactamente los mismos bytes que el código TypeScript.

### Little-endian

¿Cómo se guarda el número `0x12345678` en cuatro bytes? Hay dos convenciones. *Big-endian* pone primero el byte más significativo (`12 34 56 78`); *little-endian* pone primero el menos significativo (`78 56 34 12`). RISC-V es little-endian, igual que x86. Por eso todas las llamadas al `DataView` del código llevan el argumento `true`. Además, el camino rápido de `runInner` no usa el `DataView` sino vistas alineadas (`Int8Array`, `Int16Array`, `Int32Array`) sobre el mismo buffer, por ejemplo en el fetch:

```ts
const insn = m32[foff >>> 2];
```

Esas vistas leen en el orden de bytes de la máquina anfitriona, así que el constructor de [`CPU`](../src/cpu.ts) comprueba que sea little-endian y lanza un error si no lo es:

```ts
if (new Uint8Array(Uint16Array.of(1).buffer)[0] !== 1) throw new Error("se necesita una máquina little-endian");
```

Sin little-endian el emulador leería los bytes al revés y ninguna instrucción tendría sentido. Una ventaja de little-endian: si lees un `lb` (un byte) de la dirección de una palabra, obtienes sus 8 bits bajos, que es lo que cabría esperar.

## Cargas y guardados de 8, 16 y 32 bits

RISC-V tiene tres anchuras de acceso. Para las cargas, además, hay que decidir cómo rellenar el registro de 32 bits:

- `lb`/`lh`: extienden con signo (el byte `0xff` pasa a `-1`).
- `lbu`/`lhu`: extienden con ceros (`0xff` pasa a `255`).
- `lw`: lee la palabra entera.

Las ve en el `case 0: { // LOAD (0x03)` de [`runInner`](../src/cpu.ts). Para `lh`:

```ts
case 1: v = (off & 1) === 0 && off < ramSize ? m16[off >>> 1] : (this.load16(addr) << 16) >> 16; break;
```

Si el acceso está alineado y cae en la RAM, la vista `Int16Array` (`m16`) ya devuelve el valor con signo. Si no, se recurre a `load16` (con `DataView`, o al bus) y se extiende el signo: se sube el valor de 16 bits al extremo alto y se baja con `>>` aritmético, que copia el signo. Es la misma idea de "desplazar para extender" del capítulo 2. `lhu` usa `m16[off >>> 1] & 0xffff` por la misma razón inversa.

Los métodos [`load32`](../src/cpu.ts), `load16`, `load8` y sus gemelos `store*` siguen un patrón con dos caminos. Son la ruta general, a la que `runInner` recurre cuando el acceso no es RAM alineada. Primero, la parte de RAM:

```ts
load32(addr: number): number {
  const off = (addr - this.bus.ramBase) >>> 0;
  if (off <= this.bus.ramSize - 4) return this.bus.view.getInt32(off, true);
  if ((addr & 3) !== 0) throw new Trap(CAUSE.MISALIGNED_LOAD, addr);
  return this.io(addr, 4, CAUSE.LOAD_ACCESS) | 0;
}
```

Si la dirección cae dentro de la RAM, se lee directamente. Si no, se comprueba la alineación (en dispositivos, un acceso desalineado es un error: `MISALIGNED_LOAD`) y se pasa a la ruta lenta. El mismo truco de `>>> 0` del capítulo 1 evita dos comparaciones.

## El Bus y los dispositivos

Lo que no es RAM es un dispositivo. El contrato está en la interfaz [`Device`](../src/bus.ts):

```ts
export interface Device {
  readonly name: string;
  readonly base: number;
  readonly size: number;
  read(offset: number, width: number): number;
  write(offset: number, value: number, width: number): void;
}
```

Un dispositivo ocupa un rango `[base, base + size)` del espacio de direcciones y sabe responder a lecturas y escrituras *relativas a su base*. El bus los registra con `attach`, y cuando la CPU accede a una dirección que no es RAM, llama a `readIO` o `writeIO`, que buscan el dispositivo cuyo rango contiene la dirección:

```ts
private device(addr: number): Device {
  addr >>>= 0;
  for (const d of this.devices) {
    if (addr >= d.base && addr < d.base + d.size) return d;
  }
  throw new BusError(addr);
}
```

Es una búsqueda lineal sobre una lista de tres elementos. Sería absurdo usar un árbol. Y es la ruta *lenta*: solo se ejecuta para E/S, que es rara comparada con los accesos a RAM. Los comentarios del propio fichero lo explican: la ruta rápida accede a `view` directamente "para no pagar una llamada por acceso".

## E/S mapeada en memoria

Aquí está la idea de fondo. En un `lw` normal, la CPU no sabe si la dirección es RAM o un registro de la UART: simplemente emite una dirección. Si escribes un byte en la dirección `0x10000000`, no se guarda: la UART lo recibe y lo muestra. Si lees de la dirección del reloj, obtienes el tiempo. No existen instrucciones especiales de entrada/salida: los dispositivos *parecen memoria*. Esto es la E/S mapeada en memoria (*memory-mapped I/O*), y es la razón de que un driver de Linux sea, en el fondo, un programa que lee y escribe en direcciones concretas.

El mapa de memoria está en [`src/machine.ts`](../src/machine.ts):

```ts
export const RAM_BASE = 0x80000000;
export const UART_BASE = 0x10000000;
export const CLINT_BASE = 0x11000000;
export const SYSCON_BASE = 0x11100000;
```

La RAM vive desde `0x80000000`; la UART (consola serie) en `0x10000000`, el CLINT (temporizador) en `0x11000000` y el syscon (apagado y reinicio) en `0x11100000`. Y `Machine` conecta todo en su constructor: `for (const d of [this.uart, this.clint, this.syscon]) this.bus.attach(d);`. Este mapa se lo contamos a Linux mediante el árbol de dispositivos que construye `describe`, para que el kernel sepa dónde buscar cada cosa; si el DTB y los `attach` no coinciden, Linux tocará direcciones vacías.

Un matiz sobre efectos secundarios: leer RAM no cambia nada, pero leer un registro de dispositivo puede (por ejemplo, vaciar un buffer de recepción). Por eso la CPU no puede asumir que dos lecturas seguidas devuelvan lo mismo, y por eso la ruta de dispositivos llama a una función real y no a un `DataView`.

## Cuando la dirección no existe: BusError y Trap

¿Y si el programa lee de `0x20000000`, donde no hay nada? El bus lanza `BusError`, una excepción del *emulador*. Pero la máquina emulada debe verlo como una excepción *arquitectónica*: un fallo de acceso que el kernel pueda tratar. Es la traducción de [`io`](../src/cpu.ts) e `ioWrite`:

```ts
private io(addr: number, width: number, cause: number): number {
  try {
    return this.bus.readIO(addr, width);
  } catch (e) {
    if (e instanceof BusError) throw new Trap(cause, addr);
    throw e;
  }
}
```

El `BusError` se convierte en un `Trap` con causa `LOAD_ACCESS` (o `STORE_ACCESS` en escrituras) y `tval` igual a la dirección ofensora. `run` lo captura (capítulo 1) y salta al manejador. Dos clases de error, dos niveles: `BusError` es un detalle interno del bus; `Trap` es lo que la arquitectura define. Los demás errores (un fallo de programación en un dispositivo) se relanzan para que no se confundan con un fallo del programa emulado.

El capítulo 5 explica qué ocurre después: cómo `trap` guarda `mepc` y `mcause`.

## Ejercicio

Añade un dispositivo de "números aleatorios" de juguete, p. ej. en un script temporal: un objeto que cumpla [`Device`](../src/bus.ts), con `base: 0x12000000`, `size: 4`, y cuyo `read` devuelva un contador que se incrementa en cada lectura. Conéctalo con `bus.attach` a un `Bus` nuevo y comprueba con una `CPU` que dos llamadas a `cpu.load32(0x12000000)` devuelven valores distintos, y que `cpu.load32(0x13000000)` lanza un `Trap` (compruébalo con `instanceof`).

Comprobación: el script debe imprimir los dos valores distintos y confirmar el `Trap`. Después ejecuta `node tests/riscv-tests/run.ts rv32ui` para asegurarte de que no has tocado nada del código real.

Pista: `new Bus(0x80000000, 1 << 20)` basta como RAM de prueba, y `Trap` se exporta desde [`src/cpu.ts`](../src/cpu.ts). Recuerda que `read` recibe el desplazamiento relativo a `base`, no la dirección absoluta.

Anterior: [3. ALU y extensión M](03-alu-y-extension-m.md) · Siguiente: [5. CSR y traps](05-csr-y-traps.md)
