# 8. Rendimiento

El emulador ya arranca Linux. La pregunta natural es: ¿a qué velocidad? Un procesador real de 1 GHz ejecuta del orden de mil millones de instrucciones por segundo. La primera versión de este emulador, un intérprete en TypeScript, rondaba los **50 millones** en la máquina donde se escribió; la actual pasa de **120 millones** en la misma máquina. Este capítulo cuenta cómo se mide eso, qué cambió, qué se probó y no funcionó, y por qué.

## Cómo se miden los MIPS

MIPS son millones de instrucciones por segundo: instrucciones retiradas (`cpu.instret`, el CSR `minstret`) entre segundos. El problema es el denominador.

- **El tiempo de pared miente cuando Linux descansa.** En reposo, Linux ejecuta `wfi` y el emulador duerme (capítulo 5). Por eso [`node/run.ts`](../node/run.ts) solo cronometra las llamadas a `step` (`busyMs`) y con `--stats` imprime instrucciones entre tiempo ocupado. [`web/worker.ts`](../web/worker.ts) hace lo mismo en el navegador.
- **El tiempo de pared también miente cuando la máquina está ocupada.** En un ordenador compartido (una máquina virtual en la nube, por ejemplo) la misma ejecución puede dar 35 o 60 MIPS según lo que hagan los vecinos. Una sola cifra no vale nada.

Para comparar dos versiones de la CPU con justicia, [`tools/perf/bench.ts`](../tools/perf/bench.ts) hace tres cosas:

1. Arranca Linux con un **reloj virtual** (1 µs cada 50 instrucciones, y las esperas de `wfi` se saltan): el trabajo es el mismo en cada ejecución, no depende de la velocidad.
2. Mide el **tiempo de CPU del hilo** (`process.threadCpuUsage`), no el de pared.
3. Ejecuta la CPU de partida (una copia congelada en `tools/perf/base/`) y la actual **en rondas alternas** dentro del mismo proceso, y se queda con la mejor ronda de cada una: el ruido solo puede hacer que una ronda vaya más lenta, nunca más rápida.

Además comprueba que las dos producen el mismo texto de arranque por la UART: una CPU más rápida pero que hace otra cosa no cuenta. `./score` usa este banco para el peldaño R7.

## Primer paso: el intérprete con estado local

El bucle caliente es [`runInner`](../src/cpu.ts). El perfilador de V8 (`node --cpu-prof`) dice en qué líneas se va el tiempo, y la primera sorpresa fue esta línea:

```ts
const foff = (pc - ramBase) >>> 0;
```

`ramBase` vale `0x80000000`, que no cabe en un entero de 32 bits con signo. V8 la guarda como número de coma flotante y cada resta del fetch se hacía en coma flotante. Escrita como `((pc - ramBase) | 0) >>> 0`, con `ramBase | 0`, todo el cálculo es entero. Junto con eso:

- **`pc` y el contador en variables locales** en vez de `this.pc` y `this.instret`: V8 puede tenerlas en registros. Se vuelcan a `this` en un `finally` (también si una instrucción lanza un `Trap`) y antes de las instrucciones SYSTEM, que leen contadores.
- **Vistas tipadas alineadas** (`Int32Array`, `Int16Array`, `Int8Array`) para los accesos a RAM alineados; el `DataView` queda solo para los no alineados.
- **Un `switch` denso**: sobre los bits 6..2 de la instrucción (valores 0..31) en vez de sobre `insn & 0x7f` (valores dispersos hasta 127).

Resultado medido: unas **1,4 veces** más rápido. Bien, pero no el doble.

## Un experimento que salió mal: traducir bloques a JavaScript

La idea clásica para ir más rápido es no interpretar: traducir cada **bloque básico** (instrucciones seguidas hasta el primer salto) a una función JavaScript, con los registros en variables locales, y dejar que el JIT de V8 la compile. Se escribió, pasaba todos los riscv-tests, y era **de tres a cinco veces más lento**. El código y las medidas están en [`tools/perf/experimento-jit/`](../tools/perf/experimento-jit/LEEME.md). La explicación:

- Un bloque caliente aislado corría a ~800 MIPS. Pero el arranque de Linux reparte el tiempo entre miles de bloques: el 90 % de las instrucciones cae en unos 1100 de los ~8000 que se compilaban.
- V8 solo optimiza una función cuando ha acumulado mucha ejecución propia. Cuatrocientas funciones distintas, llamadas diez mil veces cada una, iban a ~20 MIPS en total; diez funciones, a ~250. Las demás se quedan en los niveles lentos de V8 casi toda su vida.
- Generar y compilar cada bloque costaba ~100 µs.

La lección es general: una optimización que gana en un microbanco puede perder en la carga real. Por eso se mide con el arranque de Linux, no con un bucle de juguete.

## Lo que sí funcionó: el bucle en WebAssembly

WebAssembly es otro lenguaje que ejecutan Node y los navegadores: sus enteros de 32 bits son el tipo nativo y su memoria lineal es un bloque de bytes sin comprobaciones de tipo. Si la RAM del emulador **es** esa memoria, una carga RISC-V se convierte en una carga de la máquina.

[`src/fast.ts`](../src/fast.ts) contiene el mismo bucle fetch, decodificación y ejecución que `runInner`, pero escrito como una función WebAssembly. No hay ningún compilador de por medio: [`src/wasm.ts`](../src/wasm.ts) es un ensamblador mínimo (unas 150 líneas) que escribe los bytes del módulo, con etiquetas de salto con nombre para no contar profundidades a mano. Así se lee la instrucción `LUI` en `fast.ts`:

```ts
cases[13] = () => write(() => c.get(INSN).i32(0xfffff000 | 0).op(OP.i32And)); // LUI
```

Es exactamente `v = insn & 0xfffff000` en la notación de pila de WebAssembly: "pon `insn`, pon la constante, haz `and`"; luego `write` salta al código común que guarda `v` en `x[rd]`.

La clave del diseño es **qué no hace** el motor rápido. Solo sabe el caso común: aritmética RV32IM, saltos, y cargas y stores que caen en la RAM. Ante todo lo demás (CSR, `ecall`, `mret`, atómicas, accesos a la UART, un salto desalineado, una codificación ilegal) se para **antes** de ejecutar esa instrucción y devuelve el control. Entonces [`CPU.run`](../src/cpu.ts) ejecuta esa única instrucción con el intérprete en TypeScript, que ya sabe hacer traps, CSR y dispositivos, y vuelve al motor rápido:

```ts
const k = this.fast.run(this.pc, budget - done);
this.pc = this.st[0];
this.instret += k;
...
done += this.runInner(1);
```

Así lo difícil (los capítulos 4 y 5) sigue escrito una sola vez, en TypeScript legible, y lo rápido es pequeño. Para que los dos motores vean lo mismo, [`Bus`](../src/bus.ts) crea la RAM dentro de un `WebAssembly.Memory`, y los 32 registros y la reserva de LR/SC viven justo detrás de la RAM: `cpu.x` es una vista `Int32Array` sobre esos bytes.

Resultado medido con `tools/perf/bench.ts`: unas **2,4 veces** más rápido que la CPU de partida, y en `./score` el login de Linux llega en algo más de un segundo en vez de casi dos. Los riscv-tests se ejecutan con los dos motores (`cpu.useFast = true` y `false`) y tienen que pasar con ambos.

## Tramos: Machine.step

La CPU no mira las interrupciones tras cada instrucción. [`Machine.step`](../src/machine.ts) ejecuta en **tramos** de `slice = 2048` instrucciones y entre tramo y tramo consulta el reloj y actualiza `mip`. Con 2048 instrucciones a 100 MIPS la latencia máxima de una interrupción son unos 20 µs, invisible para Linux. Escribir un CSR, `mret` o `wfi` activan `breakOut`, que corta el tramo solo si de verdad puede haber una interrupción que atender.

## Ejercicio

Compara los dos motores en tu ordenador. Ejecuta cinco veces cada una de estas órdenes (la primera con el motor rápido; la segunda, con el intérprete solo):

```
(sleep 3; printf 'root\nuname -a\npoweroff\n') | node node/run.ts --stats 2>&1 | grep stats
```

Para la segunda, añade temporalmente `m.cpu.useFast = false;` en `node/run.ts`, justo después de crear la máquina. Anota la mediana de los MIPS de cada motor. Después, con el motor rápido, mide qué fracción de las instrucciones ejecuta el intérprete: cuenta las llamadas a `runInner(1)` en `CPU.run` y divídelas entre `instret` al apagar. ¿Qué tipo de instrucción crees que domina esas salidas?

Cómo comprobarlo: las dos medianas y la fracción; `./score` debe seguir en verde al deshacer los cambios.

Pista: el ruido de la máquina puede ser mayor que la diferencia que buscas; no ejecutes nada pesado mientras mides y desconfía de una sola cifra.

Anterior: [07-arrancar-linux.md](07-arrancar-linux.md) · Siguiente: [00-indice.md](00-indice.md)
