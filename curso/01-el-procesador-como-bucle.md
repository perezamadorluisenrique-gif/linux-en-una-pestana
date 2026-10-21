# 1. El procesador como bucle

Un procesador parece una caja mágica, pero visto desde fuera hace una sola cosa, una y otra vez: coger una instrucción, entender qué pide, hacerla y pasar a la siguiente. En este capítulo vemos cómo esa idea se convierte en un `for` de TypeScript. Si sabes programar, ya tienes el 80 % de lo necesario: un emulador es un intérprete cuyo "programa" son bytes en memoria y cuyas variables son los registros.

## El estado de un hart

RISC-V llama *hart* (hardware thread) a un hilo de ejecución con su propio estado. Nuestro emulador tiene un solo hart, y su estado mínimo cabe en dos campos de [`CPU`](../src/cpu.ts):

```ts
readonly x: Int32Array;
pc = 0;
```

y en el constructor se crea como una vista sobre la memoria compartida, justo después de la RAM:

```ts
const mem = bus.ram.buffer;
this.x = new Int32Array(mem, bus.ramSize + REGS, 32);
```

Los registros viven en los mismos bytes que la RAM (tras ella) para que el motor rápido en WebAssembly (capítulo 8) los lea y escriba sin copiarlos. Para el código TypeScript sigue siendo un `Int32Array` de 32 posiciones. `x` son los 32 registros enteros `x0..x31`, y `pc` (*program counter*) es la dirección de la instrucción que toca ejecutar. Hay otros campos (CSR, modo de privilegio, reserva de LR/SC), pero los verás en capítulos posteriores. Un detalle importante: `x[0]` siempre vale 0 en RISC-V. El código no lo protege escribiendo un cero cada vez; simplemente no escribe nunca en él, con `if (rd) x[rd] = v;`. Es más barato evitar una escritura que repararla después.

¿Por qué `Int32Array` y no un array normal? Porque los números de JavaScript son `double` de 64 bits, pero la máquina emulada es de 32. Un `Int32Array` trunca a 32 bits con signo cada vez que guardas algo, así que el desbordamiento de la aritmética sale gratis. Lo retomaremos en el capítulo 3.

## Fetch, decode, execute

Cada instrucción pasa por tres fases:

1. **Fetch**: leer 4 bytes de memoria en la dirección `pc`.
2. **Decode**: separar esos 32 bits en campos (qué operación, qué registros, qué constante).
3. **Execute**: hacer la operación y actualizar registros, memoria o `pc`.

Todo ello vive en [`runInner`](../src/cpu.ts). Así empieza cada vuelta del bucle:

```ts
const pc = this.pc;
const foff = ((pc - ramBase) | 0) >>> 0;
if (foff > ramLimit) throw new Trap(CAUSE.FETCH_ACCESS, pc);
const insn = m32[foff >>> 2];
```

Se resta la base de la RAM (la CPU ve direcciones como `0x80000000`, pero el `ArrayBuffer` empieza en 0) y `>>> 0` convierte el resultado a sin signo. `ramBase` se declara como `this.bus.ramBase | 0`: `0x80000000` no cabe en un int32 positivo y V8 lo guardaría como `double`, con lo que cada resta sería de coma flotante; con `| 0` toda la cuenta es entera de 32 bits. Truco útil: si `pc` cae *antes* de la RAM, la resta da un número negativo que, tras `>>> 0`, se vuelve enorme y también supera `ramLimit`. Una sola comparación cubre ambos lados. Como `pc` está alineado a 4, la palabra es `m32[foff >>> 2]`, una lectura alineada sobre una vista `Int32Array` de la RAM; el orden de bytes (little-endian) y los accesos desalineados se explican en el capítulo 4.

Fíjate en el comentario del código: sin la extensión C (instrucciones comprimidas) todas las instrucciones miden 4 bytes y el `pc` está siempre alineado a 4. Por eso el siguiente `pc` por defecto es `next = (pc + 4) | 0`. Las instrucciones de salto cambian `next` en lugar de tocar `pc` directamente; al final de la vuelta se hace `this.pc = next`. Así, si una instrucción falla a mitad (lanza un `Trap`), el `pc` sigue apuntando a la instrucción culpable, que es exactamente lo que el hardware debe guardar en `mepc`.

## run y runInner: dos niveles

¿Por qué hay dos funciones? Mira la estructura de [`run`](../src/cpu.ts):

```ts
run(budget: number): number {
  let done = 0;
  while (done < budget) {
    if (this.waiting) break;
    try {
      done += this.runInner(budget - done);
      if (this.breakOut) { this.breakOut = false; break; }
    } catch (e) {
      if (!(e instanceof Trap)) throw e;
      this.cycle++;
      done++;
      this.trap(e.cause, e.tval, false);
    }
  }
  return done;
}
```

`runInner` es el bucle caliente: debe ser lo más rápido posible, y por eso no tiene un `try/catch` por instrucción. Cuando algo sale mal (instrucción ilegal, acceso a una dirección inexistente, `ecall`), lanza un `Trap`, la excepción de JavaScript sale de `runInner`, y `run` la captura, llama a `trap(...)` (que salta al manejador en `mtvec`) y vuelve a entrar en `runInner`. Las excepciones son raras, así que su coste no importa; el camino normal queda limpio.

El parámetro `budget` es un presupuesto: "ejecuta como mucho N instrucciones". ¿Para qué limitarlo? Porque el emulador comparte el mundo con otras cosas: el reloj, la UART, y en el navegador, la pestaña entera. Si la CPU corriera sin parar, nunca atenderíamos una interrupción de temporizador ni dejaríamos respirar a la interfaz.

`run` también sale antes de agotar el presupuesto si la CPU ejecuta `wfi` (`waiting`) o si una instrucción de CSR o `mret` pudo desbloquear una interrupción (`breakOut`). En ambos casos la máquina debe volver a mirar el mundo exterior.

## Machine.step: el director de orquesta

La CPU no sabe nada de relojes. Eso lo gestiona [`Machine.step`](../src/machine.ts):

```ts
while (done < budget && this.power === "running") {
  this.updateInterrupts();
  cpu.checkInterrupts();
  if (cpu.waiting) { ... }
  done += cpu.run(Math.min(slice, budget - done));
}
```

Ejecuta la CPU en tramos de `slice` instrucciones (2048 por defecto) y entre tramo y tramo actualiza las líneas de interrupción según el reloj y comprueba si hay alguna pendiente. Es un compromiso: mirar el reloj en cada instrucción sería lento; mirarlo cada millón haría que el sistema respondiera con retraso. Unos pocos miles de instrucciones son microsegundos reales, y a Linux le basta.

## Contar instrucciones: instret

Cada vuelta que termina sin excepción ejecuta:

```ts
this.pc = next;
this.instret++;
this.cycle++;
```

`instret` ("instructions retired") es el contador de instrucciones *retiradas*, es decir, completadas. Está expuesto al software como el CSR `minstret`. Una instrucción que lanza un `Trap` no se retira, de modo que no incrementa `instret`; en cambio `run` sí suma un ciclo y cuenta una unidad en `done`, porque el procesador sí gastó tiempo en intentarla. En este emulador `cycle` es simplemente igual a `instret` más los traps: un ciclo por instrucción, sin modelar cachés ni tuberías.

Dos contadores distintos con el mismo valor casi siempre parecen redundantes, pero no lo son: programas como `perf` o los propios tests de `riscv-tests` los leen por separado, y cada uno tiene su definición en la especificación.

## Ejercicio

Añade a [`CPU`](../src/cpu.ts) un contador `loads` que cuente cuántas instrucciones LOAD se ejecutan (opcode `0x03`), incrementándolo en el `case 0: { // LOAD (0x03)` de `runInner` (el `switch` es ahora sobre `(insn >>> 2) & 31`; el capítulo 2 explica por qué). Como el motor rápido en WebAssembly (capítulo 8) ejecuta normalmente casi todas las instrucciones, pon `cpu.useFast = false` en tu script: así `runInner` ve todas las instrucciones y `loads` cuenta de verdad. Después escribe un script corto (por ejemplo en el directorio de tareas temporales, fuera de `curso/`) que cargue un test de `build/riscv-tests/`, lo ejecute con el mismo patrón que [`runTest`](../tests/riscv-tests/run.ts) y muestre `cpu.loads` junto a `cpu.instret`.

Comprobación: la suite no debe romperse. Ejecuta `node tests/riscv-tests/run.ts rv32ui` y comprueba que todos los tests siguen pasando; además `loads` debe ser menor que `instret` y distinto de cero en `rv32ui-p-lw`.

Pista: no toques `this.pc` ni `next`; solo añade el incremento dentro del `case`, antes del `break`. Y recuerda que un LOAD que lanza `Trap` no debería contarse si lo pones al final.

Anterior: [Índice](00-indice.md) · Siguiente: [2. Decodificación](02-decodificacion.md)
