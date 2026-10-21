# 3. La ALU y la extensión M

La ALU (unidad aritmético-lógica) es la parte del procesador que suma, resta, compara y desplaza. En un emulador no hay una "unidad" separada: son líneas dentro de `runInner`. El reto no es la lógica, es traducir la aritmética de 32 bits a un lenguaje cuyos números son `double` de 64 bits. Este capítulo explica los trucos, y por qué la extensión M (multiplicar y dividir) pide algo más de cuidado.

## Enteros de 32 bits en JavaScript

Un registro RISC-V guarda 32 bits sin interpretación: la misma pauta `0xffffffff` es `4294967295` si la lees sin signo o `-1` si la lees con signo. Nuestro registro es un `Int32Array`, así que al leer `x[rs1]` siempre obtenemos la lectura *con signo*. Cuando la operación necesita la otra, la convertimos al vuelo.

Las herramientas son tres operadores de JavaScript, que convierten su operando a entero de 32 bits antes de operar:

- `| 0` fuerza el resultado a entero de 32 bits con signo. Es la forma de hacer que la suma desborde como en hardware.
- `>>> 0` reinterpreta como sin signo (da un número entre 0 y 2³²−1).
- `Math.imul(a, b)` multiplica y se queda con los 32 bits bajos del producto.

Mira la suma y la resta de la rama R en [`runInner`](../src/cpu.ts):

```ts
case 0: v = (a + b) | 0; break;
...
v = (a - b) | 0;
```

`a + b` puede valer hasta 2³²: JavaScript lo calcula sin problema en `double`, y `| 0` lo recorta a 32 bits envolviendo (`0x7fffffff + 1` pasa a `-0x80000000`). Es el mismo comportamiento que tiene el hardware, que ignora el acarreo de salida.

## Por qué existe Math.imul

La multiplicación es el caso donde `| 0` no basta. Multiplicar dos enteros de 32 bits puede dar un producto de 64 bits, y un `double` solo tiene 53 bits de mantisa: `(a * b) | 0` perdería los bits bajos por redondeo. `Math.imul` hace la multiplicación entera de 32 bits exacta y devuelve los 32 bits bajos, que es justo lo que pide la instrucción `mul`:

```ts
case 0: v = Math.imul(a, b); break;
```

## Comparar con y sin signo

RISC-V tiene dos versiones de cada comparación: `slt`/`blt` (con signo) y `sltu`/`bltu` (sin signo). La diferencia importa de verdad: `0xffffffff` es menor que 1 con signo (−1 < 1), pero mayor sin signo. En el código:

```ts
case 2: v = a < b ? 1 : 0; break;
case 3: v = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
```

Como `a` y `b` ya vienen con signo del `Int32Array`, la primera es directa; en la segunda, `>>> 0` los reinterpreta. Es el patrón general: *la lectura natural es con signo, y `>>> 0` es el interruptor para pasar a sin signo*.

Los desplazamientos siguen la misma idea. `a << (b & 31)` desplaza a la izquierda (la especificación dice que solo cuentan los 5 bits bajos de `b`, de ahí el `& 31`). A la derecha hay dos: `(a >>> (b & 31)) | 0` es el lógico (`srl`, rellena con ceros) y `a >> (b & 31)` el aritmético (`sra`, copia el signo). Fíjate en el `| 0` del primero: `>>>` devuelve un número sin signo que puede ser mayor que 2³¹, y hay que devolverlo al rango con signo para que el registro lo vea igual.

## La mitad alta del producto: MULH, MULHU, MULHSU

La extensión M añade `mul`, que da los 32 bits bajos, y tres variantes que dan los 32 bits **altos** del producto de 64 bits, según la interpretación de los operandos:

| Instrucción | Operando a | Operando b |
|---|---|---|
| `mulhu` | sin signo | sin signo |
| `mulh` | con signo | con signo |
| `mulhsu` | con signo | sin signo |

¿Para qué sirve la mitad alta? Para multiplicar números de más de 32 bits: el compilador combina `mul` y `mulhu` para emular enteros de 64 bits en una máquina de 32. Y para dividir por constantes, donde GCC usa "multiplicar por el inverso" y quedarse con la parte alta.

JavaScript no tiene producto de 64 bits sin `BigInt`, que sería lento. El proyecto parte los operandos en trozos de 16 bits, como se multiplica a mano. Esta es [`mulhu`](../src/cpu.ts):

```ts
export function mulhu(a: number, b: number): number {
  a >>>= 0;
  b >>>= 0;
  const al = a & 0xffff, ah = a >>> 16, bl = b & 0xffff, bh = b >>> 16;
  const ll = al * bl, lh = al * bh, hl = ah * bl, hh = ah * bh;
  const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff);
  return (hh + (lh >>> 16) + (hl >>> 16) + Math.floor(mid / 65536)) | 0;
}
```

Cada producto parcial de 16×16 bits cabe holgadamente en 32 bits (y en el rango exacto del `double`). Se suman los trozos con su desplazamiento correcto y `mid` recoge el acarreo que sube al siguiente trozo.

Las versiones con signo son un truco matemático elegante. Interpretar un número como con signo en lugar de sin signo resta 2³² cuando su bit alto está activo. Por tanto, el producto alto con signo es el producto alto sin signo menos las correcciones oportunas:

```ts
export function mulh(a: number, b: number): number {
  let r = mulhu(a, b);
  if (a < 0) r = (r - b) | 0;
  if (b < 0) r = (r - a) | 0;
  return r;
}
```

Si `a` es negativo, hay que restar `b` a la mitad alta; si `b` es negativo, restar `a`. [`mulhsu`](../src/cpu.ts) solo corrige el primero, porque solo `a` lleva signo. Se calcula una vez la versión sin signo y se corrige: se evita escribir tres multiplicadores.

## División y resto: los casos especiales

`div`, `divu`, `rem` y `remu` completan M. Los procesadores reales discrepan en qué hacer con una división por cero (algunos lanzan excepción, x86 por ejemplo). RISC-V decidió **no lanzar nunca excepción** y fijar los resultados:

| Caso | Cociente | Resto |
|---|---|---|
| División por cero | −1 (todo unos) | el dividendo |
| `−2³¹ / −1` (desbordamiento) | −2³¹ | 0 |

El segundo caso existe porque `+2³¹` no cabe en 32 bits con signo. El código lo refleja literalmente:

```ts
case 4: // DIV: /0 da -1; -2^31 / -1 desborda y da -2^31
  v = b === 0 ? -1 : (a === -0x80000000 && b === -1) ? a : (a / b) | 0; break;
case 6: // REM
  v = b === 0 ? a : (a === -0x80000000 && b === -1) ? 0 : (a % b) | 0; break;
```

Hay dos sutilezas. Primero, `(a / b) | 0` hace una división en coma flotante y trunca hacia cero, que es lo que RISC-V exige (el redondeo del hardware es hacia cero, igual que el `%` de JavaScript, cuyo signo sigue al dividendo). Segundo, las versiones sin signo (`divu`, `remu`) convierten con `>>> 0` antes de dividir; en `divu` el resultado de dividir por cero es −1, que visto sin signo es `0xffffffff`, el mayor valor posible.

## Ejercicio

Reescribe `mulh` para que no use `mulhu`, sino la identidad con `BigInt`: `Number((BigInt(a) * BigInt(b)) >> 32n) | 0`. Es más lenta, pero sirve de oráculo. Escribe un script temporal que compare ambas implementaciones (importa `mulh`, `mulhu` y `mulhsu` desde [`src/cpu.ts`](../src/cpu.ts)) con muchos pares aleatorios y los valores límite `0`, `1`, `-1`, `0x7fffffff` y `-0x80000000`.

Comprobación: tu script no debe encontrar discrepancias, y `node tests/riscv-tests/run.ts rv32um` debe seguir pasando entero.

Pista: para `mulhu`, convierte primero con `BigInt(a >>> 0)`; para `mulhsu`, solo `a` se queda con signo (`BigInt(a) * BigInt(b >>> 0)`). Recuerda que `BigInt >> 32n` redondea hacia menos infinito, igual que los bits altos reales.

Anterior: [2. Decodificación](02-decodificacion.md) · Siguiente: [4. Memoria y E/S](04-memoria-y-es.md)
