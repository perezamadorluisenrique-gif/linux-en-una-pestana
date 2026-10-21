# 2. Decodificación: de 32 bits a una orden

Una instrucción RISC-V es solo un número de 32 bits. Para el procesador no hay texto, ni nombres como `addi`: hay bits en posiciones fijas. Decodificar es leer esos bits y decidir qué hacer. El diseño de RISC-V es notable por lo regular que es esto, y esa regularidad es lo que permite que el decodificador de nuestro emulador quepa en un `switch`.

## Los seis formatos

Las instrucciones se agrupan en seis formatos. Todos comparten un principio: el opcode está siempre en los 7 bits bajos (`insn & 0x7f`), y los campos de registro, cuando existen, están siempre en el mismo sitio. Eso simplifica el hardware real y nuestro código.

| Formato | Para qué sirve | Ejemplo |
|---|---|---|
| R | Registro con registro | `add`, `sub`, `mul` |
| I | Registro con constante, cargas, `jalr` | `addi`, `lw` |
| S | Guardar en memoria | `sw` |
| B | Saltos condicionales | `beq`, `bltu` |
| U | Constante de 20 bits altos | `lui`, `auipc` |
| J | Salto largo | `jal` |

## Campos fijos

Los campos que comparten posición se extraen una sola vez, al principio de cada vuelta de [`runInner`](../src/cpu.ts):

```ts
const rd = (insn >>> 7) & 31;
const rs1 = (insn >>> 15) & 31;
const rs2 = (insn >>> 20) & 31;
const funct3 = (insn >>> 12) & 7;
```

`rd` es el registro destino, `rs1` y `rs2` los fuentes, y `funct3` subdivide un opcode (por ejemplo, bajo el opcode de saltos condicionales, `funct3` elige entre `beq`, `bne`, `blt`...). La técnica es siempre la misma: desplazar a la derecha hasta que el campo quede en los bits bajos y enmascarar con `& 31` (5 bits) o `& 7` (3 bits).

Hay un pequeño desperdicio asumido: en una instrucción tipo U, esos bits no son registros, y calcular `rs1` y `rs2` es trabajo inútil. Pero es mucho más barato que decidir primero el formato y luego extraer. En un intérprete, evitar ramas suele ganar a evitar operaciones aritméticas.

## `>>` contra `>>>`: el signo importa

JavaScript tiene dos desplazamientos a la derecha, y elegir bien entre ellos es la clave de este capítulo:

- `>>>` es lógico: rellena con ceros por la izquierda y trata el valor como sin signo.
- `>>` es aritmético: copia el bit de signo, preservando el valor negativo.

Los campos de registro usan `>>>` porque son números sin signo. Los inmediatos (constantes dentro de la instrucción) a menudo deben *extenderse con signo*: una constante de 12 bits que vale `-1` se escribe `0xfff` y hay que convertirla en `0xffffffff`. Con `>>` se consigue en un solo paso. Mira el formato I, el más sencillo, en la rama de [`OP-IMM`](../src/cpu.ts):

```ts
const imm = insn >> 20;
```

Los 12 bits altos de la instrucción son el inmediato. Desplazar 20 posiciones con `>>` los coloca abajo *y* propaga el bit 31 hacia arriba: extensión de signo sin escribir una máscara. Así `addi x1, x1, -1` funciona sin código especial.

## Inmediatos que se parten

En los formatos S, B, J el inmediato está troceado. Los diseñadores de RISC-V lo hicieron así para que `rs1`, `rs2` y el bit de signo estén siempre en el mismo lugar, aunque cueste ensamblar la constante. En el formato S (guardar) los 12 bits del desplazamiento se reparten entre los bits 25-31 y los bits 7-11:

```ts
const imm = ((insn >> 25) << 5) | ((insn >>> 7) & 31);
```

La parte alta usa `>> 25`, con signo, y se vuelve a subir 5 posiciones; la baja usa `>>> 7` con máscara. Solo la pieza que contiene el bit de signo se extiende.

El formato B (saltos condicionales) es más retorcido, porque el inmediato es un desplazamiento par (los saltos van a múltiplos de 2) y se omite el bit 0:

```ts
const imm = ((insn >> 31) << 12) | (((insn >>> 7) & 1) << 11) |
  (((insn >>> 25) & 0x3f) << 5) | (((insn >>> 8) & 0xf) << 1);
```

Cada línea coloca un trozo en su peso correcto: el bit 31 de la instrucción es el bit 12 del desplazamiento (el signo), el bit 7 es el bit 11, y así sucesivamente. No hace falta memorizarlo: es una tabla de la especificación que se transcribe con cuidado. Lo importante es la receta: *cada pieza se extrae, se desplaza a su peso final y se unen con `|`*.

El formato J (`jal`) funciona igual, con un inmediato de 21 bits. Y el formato U es el más simple: los 20 bits altos se quedan donde están, `insn & 0xfffff000`, y los 12 bajos valen cero. `lui` carga eso directamente en `rd`; `auipc` lo suma a `pc`. Con un `lui` seguido de un `addi` se construye cualquier constante de 32 bits.

## El switch por opcode

Con los campos extraídos, `runInner` decide qué instrucción es con un único `switch`:

```ts
if ((insn & 3) !== 3) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
switch ((insn >>> 2) & 31) {
  case 13: // LUI (0x37)
    if (rd) x[rd] = insn & 0xfffff000;
    break;
  case 5: // AUIPC (0x17)
    if (rd) x[rd] = (pc + (insn & 0xfffff000)) | 0;
    break;
  case 27: { // JAL (0x6f)
```

El opcode sigue estando en los 7 bits bajos, pero el código solo conmuta sobre los bits 6..2. ¿Por qué? Los 2 bits más bajos de toda instrucción de 32 bits valen siempre `11` (otros valores son instrucciones comprimidas, que no soportamos), así que basta comprobarlos una vez con `(insn & 3) !== 3` y descartarlos. Los 5 bits siguientes dan un número de 0 a 31, y un `switch` denso sobre ese rango se compila como una tabla de saltos en lugar de una cadena de comparaciones; el capítulo 8 vuelve sobre esto. Los valores entre paréntesis (`0x37`, `0x17`...) son el opcode completo de 7 bits, para poder contrastarlo con la especificación.

Cada `case` es una familia de instrucciones (`case 4` es OP-IMM, `case 12` es OP, `case 0` carga, `case 8` guarda, `case 24` salta con condición...). Dentro de cada familia, un segundo `switch` por `funct3` (y a veces `funct7`) distingue la operación concreta. Dos niveles de `switch` son rápidos: V8 compila un `switch` denso sobre enteros pequeños a una tabla de saltos.

Y el `default`: cualquier opcode desconocido lanza `new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn)`. No hay "no sé qué es esto": el hardware real avisa con una excepción de instrucción ilegal, y el kernel decide qué hacer. Muchos tests de [`riscv-tests`](../tests/riscv-tests/run.ts) comprueban precisamente esto.

## Por qué tanto cuidado con los bits

Porque un error aquí es silencioso. Si un inmediato B sale con un bit mal colocado, el programa no se rompe de inmediato: salta unos bytes más allá y hace cosas absurdas diez mil instrucciones después. Por eso el proyecto lleva una batería de tests oficiales, que cubren cada formato con valores en los bordes (inmediatos negativos, máximos, saltos hacia atrás).

## Ejercicio

En el `case 24: { // BRANCH (0x63)` (saltos condicionales) el inmediato B se calcula solo cuando el salto se toma. Muévelo fuera de `if (taken)` para ver el efecto, y luego revierte. Más interesante: rompe a propósito el decodificador cambiando `<< 1` por `<< 2` en el último trozo del inmediato B y observa qué tests fallan.

Ojo: este cambio solo afecta al intérprete en TypeScript. [`tests/riscv-tests/run.ts`](../tests/riscv-tests/run.ts) ejecuta cada test dos veces, con el motor rápido en WebAssembly (`useFast = true`) y con el intérprete solo (`useFast = false`), y exige que pasen los dos. Con tu decodificador roto el motor rápido seguirá pasando, así que los fallos aparecerán en la parte `intérprete: ...` del mensaje, no en `motor rápido: ...`.

Comprobación: ejecuta `node tests/riscv-tests/run.ts rv32ui` antes y después de romperlo. Con el código original todos pasan; con el cambio, los tests de saltos (`beq`, `bne`, `blt`, `bge`, `bltu`, `bgeu`) deben fallar indicando el caso en su parte `intérprete:`. Deshaz el cambio y comprueba que vuelve a pasar todo.

Pista: la línea que cambias es la que contiene `& 0xf) << 1`. Si falla algo más que los saltos, mira qué otros tests usan saltos internamente (casi todos terminan en un `bne`).

Anterior: [1. El procesador como bucle](01-el-procesador-como-bucle.md) · Siguiente: [3. ALU y extensión M](03-alu-y-extension-m.md)
