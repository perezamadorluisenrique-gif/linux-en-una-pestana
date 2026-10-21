# 5. CSR, traps e interrupciones

Hasta ahora la CPU era un bucle ingenuo: lee una instrucción, la ejecuta, pasa a la siguiente. Pero un sistema operativo necesita algo más. Necesita que el hardware le avise cuando un programa hace algo prohibido, cuando pasa el tiempo o cuando llega una tecla. Necesita poder decir "este código corre con privilegios y este otro no". Todo eso vive en un grupo de registros especiales, los **CSR** (Control and Status Registers), y en un mecanismo único, el **trap**.

## Los CSR: registros que no son x0..x31

Los 32 registros enteros sirven para calcular. Los CSR sirven para configurar y vigilar a la propia CPU. Se acceden con instrucciones propias (`csrrw`, `csrrs`, `csrrc` y sus variantes con inmediato) y un número de 12 bits. En [`csrRead`](../src/cpu.ts) hay un `switch` enorme sobre ese número:

```ts
switch (csr) {
  case 0x300: return this.mstatus;
  case 0x301: return MISA;
  case 0x304: return this.mie;
  case 0x305: return this.mtvec;
  case 0x341: return this.mepc;
  case 0x342: return this.mcause;
  case 0x343: return this.mtval;
  case 0x344: return this.mip;
```

Los que importan para arrancar Linux son pocos:

- **mstatus**: el interruptor general. Su bit `MIE` activa o desactiva las interrupciones; `MPIE` y `MPP` guardan el estado anterior (ahora lo vemos).
- **mtvec**: la dirección a la que salta la CPU cuando ocurre un trap. Es el "manejador de errores" que el kernel registra al arrancar.
- **mepc**: la dirección de la instrucción que estaba ejecutándose cuando ocurrió el trap, para poder volver.
- **mcause**: por qué ocurrió. Si el bit 31 está a 1 es una interrupción; si no, una excepción.
- **mtval**: información extra, como la dirección que falló o la instrucción ilegal.
- **mie / mip**: qué interrupciones están permitidas y cuáles están pendientes.

Fíjate en que no todo es escribible. [`csrWrite`](../src/cpu.ts) filtra: `mie` solo conserva los bits de software, temporizador y externa; `mtvec` borra el bit 1 reservado; `mepc` borra los dos bits bajos porque no hay instrucciones comprimidas. El porqué: el hardware real también ignora esos bits, y un kernel que asume lo contrario no funcionaría en una máquina de verdad. Además, los CSR cuyo número empieza por `11` en los bits 11:10 son de solo lectura, y los CSR del modo M no se pueden tocar desde el modo U: ambos casos lanzan una instrucción ilegal.

## Dos modos de privilegio

La CPU tiene dos modos: **M** (máquina, todo permitido) y **U** (usuario, restringido). Los dos bits de arriba del número de CSR indican el privilegio mínimo para usarlo, por eso `csrRead` empieza con la comprobación `((csr >>> 8) & 3) > this.priv`. En Linux sin MMU, el kernel corre en M y los programas como busybox en U. Sin MMU no hay aislamiento de memoria entre procesos, pero el modo U sigue impidiendo tocar los CSR y ejecutar `mret`.

## Trap: una sola puerta de entrada

Una **excepción** es síncrona: la provoca la instrucción en curso (una instrucción ilegal, un acceso a una dirección donde no hay nada, un `ecall`). Una **interrupción** es asíncrona: viene de fuera. El hardware trata ambas igual, y [`trap`](../src/cpu.ts) lo resume:

```ts
trap(cause: number, tval: number, isInterrupt: boolean): void {
  this.mepc = this.pc;
  this.mcause = isInterrupt ? (cause | 0x80000000) : cause;
  this.mtval = isInterrupt ? 0 : tval;
  const mie = (this.mstatus & MSTATUS_MIE) !== 0;
  this.mstatus = (this.mstatus & ~(MSTATUS_MPIE | MSTATUS_MIE | MSTATUS_MPP))
    | (mie ? MSTATUS_MPIE : 0) | (this.priv << 11);
  this.priv = PRIV_M;
```

Lo que hace, en orden: apunta dónde estaba (`mepc`), anota la causa, **apaga las interrupciones** copiando `MIE` a `MPIE`, guarda el modo anterior en `MPP`, entra en modo M y salta a `mtvec`. Que desactive las interrupciones no es capricho: si otra llegase a mitad del manejador, machacaría `mepc` y se perdería el rastro de dónde volver.

## Cómo run() convierte excepciones en traps

Aquí hay una decisión de diseño interesante. La clase [`Trap`](../src/cpu.ts) es un objeto que se **lanza** con `throw`. Un acceso a memoria inválido, un decodificador que no reconoce la instrucción o `csrRead` con permisos insuficientes simplemente escriben `throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn)`. No hace falta comprobar códigos de error en cada rincón del bucle. Quien lo recoge es `run()`:

```ts
try {
  done += this.runInner(budget - done);
  if (this.breakOut) { this.breakOut = false; break; }
} catch (e) {
  if (!(e instanceof Trap)) throw e;
  this.cycle++;
  done++;
  this.trap(e.cause, e.tval, false);
}
```

Si `runInner` lanza, el `catch` llama a `trap` y el bucle sigue ejecutando, ya en el manejador. Cualquier otro error (un fallo del emulador) se relanza: un `TypeError` nuestro no debe disfrazarse de excepción de la CPU. Como el `pc` no se ha actualizado cuando la instrucción lanza, `mepc` apunta justo a la instrucción culpable.

## mret: la vuelta

El manejador termina con `mret`. Es la imagen especular de `trap`: restaura el modo desde `MPP`, copia `MPIE` de vuelta a `MIE` y salta a `mepc`. Está en `system()`, la función que atiende `ecall`, `ebreak`, `mret`, `wfi` y las instrucciones CSR. Fíjate en el detalle de que `mret` pone `breakOut = true`: así el bucle interno devuelve el control a la máquina, que mira si ahora hay interrupciones atendibles.

## Interrupciones

Dos funciones deciden. [`pendingInterrupt`](../src/cpu.ts) calcula `mip & mie`, es decir, "pendiente y permitida", y respeta el interruptor global: en modo M, si `MIE` está a 0, nada pasa. Si hay varias, elige por prioridad externa, software, temporizador. [`checkInterrupts`](../src/cpu.ts) llama a `trap` con ese número. Quien pone los bits en `mip` no es la CPU sino la máquina, entre tramos de ejecución (lo verás en el capítulo 6, `updateInterrupts`). Por eso `csrWrite` y `mret` activan `breakOut`: si el programa acaba de habilitar una interrupción, la máquina debe poder mirarla ya, no 2048 instrucciones después.

## WFI: dormir hasta que pase algo

Cuando Linux no tiene nada que hacer ejecuta `wfi` (wait for interrupt). Si el emulador siguiera girando en vacío quemaría un núcleo del ordenador anfitrión al 100 %. En su lugar `system()` pone `this.waiting = true` y sale; `run()` hace `break` mientras `waiting` esté activo, y `Machine.step` devuelve cuántos microsegundos faltan para el próximo evento. Fíjate en un matiz de `checkInterrupts`: la primera línea despierta la CPU si `mip & mie` no es cero **aunque `MIE` valga 0**, porque así lo define la especificación.

## LR/SC y AMO: atomicidad con un solo hart

Linux usa instrucciones atómicas para sus cerrojos. [`atomic`](../src/cpu.ts) implementa la extensión A. `LR.W` lee y anota la dirección en `reservation`; `SC.W` escribe solo si la reserva sigue viva y devuelve 0 si lo consigue. Las AMO (`amoadd`, `amoswap`, etc.) leen, calculan y escriben. Con un único hart nadie puede interponerse entre la lectura y la escritura, así que "atómico" es simplemente hacer ambas cosas seguidas. La reserva se rompe en `trap` (`this.reservation = -1`): si te interrumpen entre `LR` y `SC`, el `SC` debe fallar, y el código del kernel reintenta.

## Ejercicio

Escribe un test bare-metal de la interrupción del temporizador, sin Linux. Plan: crea una `Machine` (o un `CPU` más un `Clint`) y carga a mano un programa que (1) instale un manejador en `mtvec`, (2) ponga `mtimecmp` unos cientos de microsegundos por delante de `mtime`, (3) active `MTIE` en `mie` y `MIE` en `mstatus`, y (4) entre en un bucle. El manejador debe escribir un valor en una dirección de RAM conocida y apagar la interrupción reprogramando `mtimecmp`.

Cómo comprobarlo: ejecuta `machine.step(...)` hasta que esa dirección cambie y verifica que `cpu.mcause` vale `0x80000007` (bit 31 más la causa `IRQ.MTI`). Para un reloj determinista inyecta `clock` en `MachineOptions` y avánzalo tú. Puedes inspirarte en cómo [`tests/riscv-tests/run.ts`](../tests/riscv-tests/run.ts) carga un programa y lo ejecuta.

Pista: para ensamblar no necesitas compilador, escribe las palabras de 32 bits a mano (`lui`, `csrw`, `sw`, `mret`) con `bus.load`, o usa `cpu.csrWrite` directamente desde TypeScript y comprueba solo la entrada en el trap.

Anterior: [04-memoria-y-es.md](04-memoria-y-es.md) · Siguiente: [06-dispositivos-y-device-tree.md](06-dispositivos-y-device-tree.md)
