# Experimento descartado: traducir bloques a funciones JavaScript

Sesión 89383ac7 (2026-10-20). `jit.ts.txt` genera, para cada bloque básico caliente, el texto de
una función JS (registros en variables locales, constantes resueltas, bucles que vuelven al inicio
del bloque dentro de la propia función) y la crea con `new Function`. `cpu.diff` es el parche
sobre `src/cpu.ts` (caché de bloques, invalidación por páginas de 1 KiB en cada escritura).
Pasaba los 76 riscv-tests y arrancaba Linux igual, pero era **3-5 veces más lento** que el intérprete.

Por qué (medido con microbancos en esta máquina):

- Un bloque caliente aislado corre a ~800 MIPS, pero el arranque de Linux reparte el tiempo en
  miles de bloques (el 90 % de las instrucciones cae en ~1100 bloques de ~8000 compilados).
- V8 solo optimiza una función cuando ha acumulado mucha ejecución propia. Con 400 funciones
  distintas llamadas 10 000 veces cada una, el conjunto va a ~20 MIPS; con 10 funciones, a ~250.
- Compilar cada bloque cuesta ~100 µs (generar el texto + que V8 lo analice).
- Una función gigante con todos los bloques no sirve: V8 no optimiza funciones tan grandes.
- Un módulo WebAssembly por bloque tampoco: compilar e instanciar cuesta ~200 µs y cada llamada
  JS→wasm desde un sitio polimórfico ~0,1-1 µs.

Lo que funcionaría (v86 lo hace) es un despachador dentro de WebAssembly con `call_indirect` y
bloques añadidos a una tabla compartida: sin llamadas JS→wasm por bloque. Es mucho más trabajo.
