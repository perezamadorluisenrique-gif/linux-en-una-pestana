# Escuela en una pestaña: plan de creación

Fecha: 2026-11-10 (versión 1). Apuesta 5 de `/mnt/project-files/fable-5-2/plan.md`. Solo plan: nada de esto está construido. El avance se apunta en `docs/ESCUELA-PROGRESS.md`.

Cómo leer este documento: las secciones 1 a 7 son para Enrique. Las secciones 8 y 9 son las órdenes de trabajo para quien construye (Opus y Sonnet, sin Fable): se siguen en orden, una por PR.

Aviso de honestidad: lo que la imagen de Linux actual trae dentro, y si Git y las redes caben en el emulador, no está comprobado. Las órdenes E0.1 y E4.0 son pruebas de viabilidad con un plan B escrito.

## 1. La meta en una frase

Una persona abre una página en español, tiene delante una máquina de verdad y un reto, escribe la orden, y la página le dice si lo logró; así hasta terminar un curso entero, sin instalar nada, sin cuenta y sin conexión después de la primera visita.

Cinco cursos, cada uno con su máquina real:

| Curso | Máquina dentro de la pestaña | Estado |
|---|---|---|
| 1. Terminal de Linux | Nuestro emulador RISC-V arrancando Linux | Emulador hecho; curso nuevo |
| 2. Python desde cero | Pyodide (Python real en WebAssembly) | Corrector y app hechos en `libro-python-es`; curso nuevo y propio |
| 3. SQL | SQLite oficial en WebAssembly | Nuevo |
| 4. Git | Git real dentro del Linux del emulador, si E4.0 lo logra; si no, libgit2 en WebAssembly | Nuevo; es el riesgo técnico mayor |
| 5. Redes | Dos máquinas Linux virtuales en la misma pestaña, conectadas entre sí | Nuevo; depende de E4.0 |

Lo que se promete al alumno, en este orden:

1. **Practico de verdad.** No es un simulador de respuestas: es un Linux, un Python y una base de datos reales.
2. **Me corrige al momento** y me da una pista cuando me atasco.
3. **Funciona en mi móvil barato y sin internet.**
4. **Está en español bien escrito,** pensado para quien empieza.

## 2. Dónde estamos hoy y qué se medirá

`linux-en-una-pestana` tiene el emulador (RV32IMA, modos M y U, UART, temporizador y apagado; sin disco ni red), arranca Linux 6.1 sin MMU con busybox desde una imagen ajena ya construida, y un curso de 8 capítulos sobre *cómo funciona el emulador*, que no es un curso de terminal. `libro-python-es` tiene 90 ejercicios autocorregidos con Pyodide y su app sin conexión; su texto y sus ejercicios son CC BY-NC-SA (traducción de OpenStax) y no se pueden vender, pero su código es MIT y se reutiliza.

| Qué se mide | Hoy | Meta |
|---|---|---|
| Tiempo desde abrir la página hasta poder escribir en Linux (portátil medio) | arranque completo, por medir en E0.1 | menos de 2 s con instantánea |
| Lo mismo en un móvil de gama baja emulado (CPU ×4 más lenta) | por medir | menos de 6 s |
| Retos cuya solución de referencia pasa su corrector y cuya solución vacía falla | 0 | 100 % de los retos de cada curso |
| Retos del curso 1 | 0 | 50 |
| Peso de la primera visita del curso 1 (comprimido) | por medir | menos de 8 MB |
| Funciona sin conexión tras la primera visita (prueba automática) | solo en el libro de Python | todos los cursos |
| Fallos de accesibilidad de axe | 0 en las páginas actuales | 0 |

## 3. Qué es gratis y qué es Pro (decisión cerrada)

**La regla:** los cinco cursos completos, sus máquinas y el uso sin conexión son gratis para siempre. Se cobrará, más adelante, por profundizar y por acreditar.

| Función | Queda en | Por qué |
|---|---|---|
| Los cinco cursos base completos, con todos sus retos y pistas | **Gratis** | Es la promesa y el alcance |
| Las máquinas, también como «patio libre» sin retos | **Gratis** | Igual |
| Uso sin conexión y progreso guardado en el dispositivo | **Gratis** | Aulas sin internet |
| Modo aula: exportar e importar el progreso en un archivo, y hoja del profesor con las soluciones | **Gratis** | Los profesores son el mejor canal de difusión |
| Diploma sencillo de curso terminado (se genera en el dispositivo, sin verificación) | **Gratis** | Motiva; no acredita |
| Cursos avanzados (Bash para automatizar, administración de un servidor, Python intermedio, SQL avanzado) | **Pro** | Profundizar |
| Certificado verificable con examen final | **Pro** | Acreditar |
| Los libros de cada curso en Amazon, en papel y ebook, hechos con Book Studio | **De pago** (precio de libro) | La apuesta 1 alimenta a la 5 |

Precios de referencia, apagados: 15 USD por curso avanzado o 39 USD por todos; libros a precio de KDP. Nada de esto se construye ni se menciona hasta el hilo G, y no se enciende sin que Enrique lo diga.

Otras decisiones cerradas:

1. **Todo vive en `linux-en-una-pestana`,** en la carpeta `escuela/`, publicado en `…/linux-en-una-pestana/escuela/`. El emulador es el corazón y ya está ahí; así no hace falta repositorio nuevo. La portada del sitio pasa a ser la escuela; el curso actual sobre el emulador queda como «Cómo funciona por dentro».
2. **Contenido propio.** Ningún texto ni ejercicio de `libro-python-es` se copia a la escuela (su licencia impide vender). Los cursos nuevos son CC BY-SA 4.0 y el código MIT. La escuela enlaza al libro como lectura complementaria.
3. **Orden de los cursos: Linux, Python, SQL, Git, Redes.** Los tres primeros no tienen riesgo técnico; los dos últimos dependen de una prueba de viabilidad.
4. **Imagen de Linux propia y reproducible** desde el primer curso, construida en GitHub Actions (el repositorio es público: gratis) y guardada como archivo de un release con su SHA-256. Sin ella no se pueden meter los retos ni el corrector dentro de la máquina.
5. **Los retos se corrigen mirando el estado de la máquina,** no lo que el alumno tecleó: si llegó al resultado por otro camino, vale.
6. **Sin cuentas, sin servidor, sin analítica, sin IA.** El progreso vive en el dispositivo.
7. **Español neutro, de tú.** Un glosario único (`escuela/glosario.tsv`) para todos los cursos.

## 4. Las fases

| Hilo | Fase | Qué entrega | PRs |
|---|---|---|---|
| A | 0 | Imagen propia, canal de corrección, instantáneas, formato de curso y de reto | E0.1 a E0.5 |
| B | 1 | Curso 1, Terminal de Linux: aula y 50 retos | E1.1 a E1.5 |
| C | 2 | Curso 2, Python desde cero: 60 retos | E2.1 a E2.4 |
| D | 3 | Curso 3, SQL: 45 retos | E3.1 a E3.4 |
| E | 4 | Prueba de viabilidad (MMU o plan B) y curso 4, Git: 40 retos | E4.0 a E4.4 |
| F | 5 | Curso 5, Redes: 35 retos | E5.1 a E5.4 |
| G | 6 | Lanzamiento, modo aula, libros y Pro apagado | E6.1 a E6.5 |

Lo que verá el alumno al final de cada hilo:

- **A:** nada nuevo a la vista; por dentro, la máquina abre en dos segundos y sabe decir si un reto está resuelto.
- **B:** el primer curso completo, con 50 retos, usable en el móvil y sin conexión.
- **C, D:** dos cursos más con el mismo aula.
- **E, F:** Git y redes practicados en máquinas reales.
- **G:** diploma, modo aula y los libros.

## 5. Cómo se gana dinero después (apagado hasta que Enrique diga)

Lo de la sección 3: cursos avanzados, certificados y libros. Los libros se maquetan con Book Studio desde el mismo Markdown de los cursos (`herramientas/libro_bookstudio.py` de `libro-python-es` es el modelo) y son lo primero que se podría vender, porque no necesitan sistema de pagos propio.

## 6. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Es contenido: exige constancia | Formato de reto único y comprobado por máquina; un curso por hilo; cada reto lleva solución de referencia que el CI ejecuta, así un curso no «se pudre» |
| Contenido con errores | El CI ejecuta todas las soluciones dentro de la máquina real; revisión de cada capítulo por un segundo modelo con una lista fija (orden E1.5 y equivalentes) |
| Construir la imagen propia no sale | Plan B escrito en E0.1: seguir con la imagen actual e inyectar los archivos por la consola antes de la instantánea |
| Git no cabe en un Linux sin MMU | E4.0 intenta añadir MMU al emulador con una prueba ejecutable; si falla dos veces, plan B (libgit2 en WebAssembly con una terminal propia) y el curso de Redes se rehace sobre ese mismo plan o se aplaza |
| Lento en móviles baratos | Presupuesto de tiempo como prueba con CPU frenada; instantáneas; el motor rápido en WebAssembly ya existe |
| La primera visita pesa mucho | Presupuesto de peso como prueba; cada curso baja solo su máquina |
| Poca difusión | Hilo G: modo aula para profesores, guías que responden búsquedas, vídeo; publicar solo con OK |
| Confusión de licencias con el libro de OpenStax | Regla 4 de la sección 8 y prueba que busca frases del libro en la escuela |

## 7. Lo único que necesita Enrique

- **Nada para empezar:** el repositorio existe y es público.
- **Una vez, al cerrar el hilo A (laptop):** crear la etiqueta del release que guarda la imagen de Linux, si el flujo no puede crearla solo. Se apuntará en `cola-laptop.md`.
- **OK antes de:** cada post en X y cualquier envío a directorios de cursos (hilo G).
- **Opcional pero valioso:** leer el capítulo 1 del curso de terminal cuando esté (10 minutos) y decir si el tono es el que quiere. Se corrige una vez y queda como regla para los demás cursos.

---

## 8. Reglas para quien ejecuta

1. **Una orden de trabajo = un PR,** en el orden de la sección 9. Máximo 5 PRs por hilo.
2. **Antes de cada PR:** `npm ci && npm run imagen && npm run build && npm test`, y desde E0.4 `npm run retos` (ejecuta todas las soluciones de referencia). `./setup.sh && ./score` cuando la orden toque `src/`. CI verde antes de fusionar. Fusionar publica el sitio: Enrique ya acepta eso para productos publicados.
3. **Nunca:** saltar o aflojar una prueba; enlaces de claude.ai o de sesión en commits o PRs; analítica, cuentas o recursos de otros servidores; guardar en el repositorio la imagen de Linux u otros binarios GPL (se bajan con SHA-256 y sus fuentes se citan en `CREDITOS.md`); mencionar Pro o precios en el sitio.
4. **Nunca copiar** texto ni ejercicios de `libro-python-es` ni de ningún curso ajeno. `pruebas/originalidad.mjs` (orden E2.1) lo vigila.
5. **Cada reto es un archivo con cinco partes obligatorias:** enunciado, preparación, comprobación, solución de referencia y pistas. El CI falla si la solución no pasa la comprobación, si la máquina recién preparada ya la pasa, o si falta una pista.
6. **Estilo de escritura** (`escuela/ESTILO.md`, orden E0.5): frases cortas, de tú, un concepto nuevo por reto, cada orden nueva se ve antes de pedirla, ningún término sin entrada en el glosario, sin anglicismos cuando hay palabra española asentada.
7. **Si una meta numérica no se alcanza:** no se toca la prueba; se apunta el número en `docs/ESCUELA-PROGRESS.md` y se sigue, salvo los presupuestos de tiempo y peso, que bloquean el PR si empeoran.
8. **Si el mismo check falla dos veces:** parar y pasar la orden al modelo siguiente, en hilo nuevo, con lo aprendido escrito. En E0.1 y E4.0, pasar al plan B.
9. **Mensajes de commit** en inglés e imperativo; nombres de archivos, textos y comentarios del sitio en español, como hoy.

Modelo y esfuerzo (regla MODELOS del proyecto):

| Órdenes | Modelo | Esfuerzo | Por qué |
|---|---|---|---|
| E0.1, E0.2, E0.3 | Opus | medio | Imagen, dispositivo nuevo e instantáneas: motor |
| E0.4, E0.5 | Sonnet | medio | Formato y herramientas con orden clara |
| E1.1 | Sonnet | medio | Interfaz |
| E1.2, E1.3, E1.4 | Sonnet | medio | Escribir retos con formato fijo y CI que los ejecuta |
| E1.5 y las revisiones de cada curso | Opus | alto | Revisión de primer release de contenido |
| E2.x, E3.x | Sonnet | medio | Igual que el curso 1 |
| E4.0 | Opus | medio | Añadir MMU al emulador: lo más difícil del plan |
| E4.1 | Opus | medio | Máquina nueva |
| E4.2 a E4.4, E5.2 a E5.4 | Sonnet | medio | Contenido |
| E5.1 | Opus | medio | Red entre dos máquinas |
| E6.x | Sonnet | medio | Documentos y empaquetado |
| Leer registros de arranque, comprobar glosario | Haiku, en subagente | bajo | Lectura |

## 9. Órdenes de trabajo

Mapa del código actual, para no explorar: `src/cpu.ts` (intérprete), `src/fast.ts` y `src/wasm.ts` (motor rápido en WebAssembly), `src/bus.ts`, `src/devices.ts` (`Uart16550`, `Clint`, syscon), `src/dtb.ts` y `src/machine.ts` (árbol de dispositivos escrito a mano y montaje), `src/elf.ts`; `node/run.ts` (Linux en la terminal); `web/worker.ts` y `web/main.ts` (emulador en un Web Worker con xterm.js); `herramientas/construir.mjs` (construye `_site/` desde `sitio/` y `curso/`), `herramientas/obtener-imagen.sh` (baja la imagen de cnlohr y comprueba el SHA); `pruebas/arranque.mjs` y `pruebas/axe.mjs` (Playwright). En `libro-python-es`: `app/src/worker.js` (Pyodide en un Worker), `ejercicios/arnes.py` (corrector), `app/sw.plantilla.js` (sin conexión).

Estructura nueva:

```
escuela/
  ESTILO.md  glosario.tsv
  cursos/<curso>/curso.json            título, máquina, capítulos
  cursos/<curso>/NN-capitulo/00-texto.md
  cursos/<curso>/NN-capitulo/NN-reto.md   un reto por archivo
  aula/        la interfaz común (TypeScript)
  maquinas/    linux/  python/  sql/  git/  red/   un adaptador por máquina
imagen/        configuración de buildroot y archivos que van dentro de Linux
```

Formato de un reto (`NN-reto.md`): propiedades (`id`, `titulo`, `concepto`, `ordenes`), y cinco bloques con nombre: `enunciado` (Markdown), `preparar` (guion que deja la máquina lista), `comprobar` (guion que termina con 0 si está resuelto y, si no, escribe una línea de pista específica), `solucion` (guion de referencia) y `pistas` (de una a tres, de menos a más explícita). Todas las máquinas ofrecen al aula la misma interfaz: `preparar(reto)`, `comprobar(reto) → { ok, pista? }`, `reiniciar()`, `terminal`.

---

### HILO A: cimientos

### E0.1 Imagen de Linux propia y reproducible (Opus, medio)

**Objetivo:** construir nosotros el Linux que arranca, con lo que los cursos necesitan dentro.

**Pasos:**

1. `imagen/`: configuración de buildroot partiendo de la de cnlohr citada en `CREDITOS.md` (kernel 6.1 sin MMU, uClibc, busybox), con estos cambios: dos puertos serie 8250 (`CONFIG_SERIAL_8250_NR_UARTS=2` y `RUNTIME_UARTS=2`); busybox con `vi`, `less`, `find`, `grep`, `sed`, `awk`, `sort`, `uniq`, `wc`, `tar`, `gzip`, `ps`, `top`, `kill`, `chmod`, `chown`, `ln`, `du`, `df`, `head`, `tail`, `cut`, `tr`, `diff`, `tee`, `xargs`, `env`, `which`, `date`, `adduser`, `su`, `id`, y `ash` con historial y completado; usuario `alumno` sin privilegios además de `root`; idioma y mensajes en español donde busybox lo permita; `/etc/motd` propio; carpeta `/curso/` vacía.
2. `.github/workflows/imagen.yml` (manual, `workflow_dispatch`): construye con buildroot en `ubuntu-24.04`, con caché, y sube `Image` y `SHA256SUMS` como artefacto y, si el flujo tiene permiso, como archivos de un release `imagen-vN`. `herramientas/obtener-imagen.sh` pasa a bajar ese release y comprobar el SHA; conserva la imagen de cnlohr como `--original`.
3. Fuentes GPL: `CREDITOS.md` enlaza la configuración exacta (`imagen/`), las versiones y dónde bajar las fuentes.
4. Prueba: `pruebas/arranque.mjs` sigue llegando a la shell y `uname -a` responde; nueva comprobación `ls /dev/ttyS1` y `su alumno -c id`.
5. **Plan B** (si la construcción falla dos veces): seguir con la imagen de cnlohr; los archivos del curso y el agente de E0.2 se inyectan tecleándolos por la consola (`cat > archivo << 'FIN'`) justo antes de tomar la instantánea de E0.3; el canal de corrección usa la misma consola con marcas ocultas, mientras el aula bloquea el teclado. Apuntarlo en `ESCUELA-PROGRESS.md`.

**Hecho cuando:** `npm run imagen && npm run build && npm test` pasa con la imagen propia y el flujo de Actions la reconstruye con el mismo SHA dos veces seguidas (o, si no es reproducible al bit, se documenta por qué y se fija el SHA del release).

**PR:** `Build our own Linux image with a second serial port`.

### E0.2 Canal de corrección (Opus, medio)

**Objetivo:** que la página pueda preguntar a la máquina «¿está resuelto?» sin estorbar lo que el alumno ve.

**Pasos:**

1. `src/machine.ts` y `src/dtb.ts`: segundo `Uart16550` en otra dirección, con su nodo en el árbol de dispositivos → `/dev/ttyS1`. `./score` sigue verde.
2. Dentro de la imagen, `/usr/bin/agente` (guion de `ash` lanzado por `init` sobre `/dev/ttyS1`): lee líneas `EJECUTA <id> <longitud>` seguidas del guion, lo ejecuta como `root` con `sh`, y responde `FIN <id> <código> <longitud>` y la salida. Sin eco y sin tocar la terminal del alumno.
3. `escuela/maquinas/linux/canal.ts`: `ejecutar(guion, { tiempoMax }) → { codigo, salida }`, con cola, tiempo máximo y recuperación si el agente no contesta (reinicia el agente con una orden por la consola principal, nunca la máquina).
4. Pruebas en Node (`node/run.ts` como biblioteca): 100 ejecuciones seguidas, guiones con comillas, saltos de línea y 64 KB de salida; una ejecución mientras la consola principal está dentro de `vi`.

**Hecho cuando:** las pruebas pasan con los dos motores (intérprete y WebAssembly).

**PR:** `Add a control channel to the guest`.

### E0.3 Instantáneas (Opus, medio)

**Objetivo:** abrir la máquina ya arrancada.

**Pasos:**

1. `src/snapshot.ts`: `guardar(maquina) → Uint8Array` y `restaurar(bytes)`: registros de la CPU, CSR, estado de los dispositivos, contadores y la RAM, comprimida por páginas (las páginas a cero no se guardan; el resto con `CompressionStream('gzip')` en el navegador y `zlib` en Node). Formato con versión y SHA de la imagen: una instantánea de otra imagen se rechaza.
2. `herramientas/instantanea.mjs`: en la construcción, arranca en Node hasta la shell del usuario `alumno`, espera al agente, y guarda `_site/escuela/maquinas/linux/base.snap`.
3. `web/worker.ts`: si hay instantánea, la restaura; si falla, arranca normal.
4. El motor rápido: comprobar que el código WebAssembly generado no guarda estado fuera de lo que se restaura; si lo hace, invalidarlo al restaurar.
5. Pruebas: guardar y restaurar a mitad de un `sort` da la misma salida que sin interrupción; presupuestos de la sección 2 (2 s en escritorio; 6 s con la CPU frenada ×4 en Playwright); peso de `base.snap` por debajo de 6 MB.

**Hecho cuando:** presupuestos cumplidos, o apuntados según la regla 7.

**PR:** `Boot from a snapshot`.

### E0.4 Formato de curso y de reto, y su corrector en CI (Sonnet, medio)

**Pasos:** `escuela/aula/formato.ts` (lee `curso.json` y los `NN-reto.md`; errores con archivo y línea); `herramientas/retos.mjs` (`npm run retos`): por cada reto de cada curso, restaura la máquina, ejecuta `preparar`, comprueba que `comprobar` **falla**, ejecuta `solucion`, comprueba que `comprobar` **pasa**, y mide el tiempo (máximo 5 s por reto). Curso de muestra con 3 retos de Linux para probar el propio corrector, incluidos uno mal hecho a propósito en las pruebas (la solución no pasa) y otro que ya pasa sin hacer nada: el corrector debe rechazar los dos.

**Hecho cuando:** `npm run retos` pasa con los 3 retos de muestra y rechaza los dos defectuosos de la prueba.

**PR:** `Define the course format and run every reference solution in CI`.

### E0.5 Guía de estilo y glosario (Sonnet, medio)

**Pasos:** `escuela/ESTILO.md` (reglas de la sección 8.6 con ejemplos de bien y mal, plantilla de capítulo y de reto, cómo escribir una pista); `escuela/glosario.tsv` (término, definición de una línea, primer reto donde aparece); `pruebas/estilo.mjs`: falla si un reto usa una orden que no se presentó antes en el curso, si un término en negrita no está en el glosario, si una frase del enunciado pasa de 30 palabras o si falta una pista.

**Hecho cuando:** `node pruebas/estilo.mjs` pasa sobre el curso de muestra y detecta 4 defectos sembrados en su prueba.

**PR:** `Add the writing guide, the glossary and a style check`.

---

### HILO B: curso 1, Terminal de Linux

### E1.1 El aula (Sonnet, medio)

**Pasos:**

1. `escuela/aula/`: página de curso con el índice de capítulos y el progreso; página de reto con el enunciado a la izquierda y la terminal a la derecha (en móvil, enunciado arriba plegable y terminal abajo, con una fila de teclas extra: Tab, Ctrl, flechas, `|`, `/`, `~`).
2. Botones «Comprobar» (también se comprueba solo cada vez que el alumno vuelve al indicador de la shell, con un mínimo de 2 s entre comprobaciones), «Pista» (de una en una), «Reiniciar reto» y «Siguiente».
3. Progreso en `localStorage` (por curso, lista de retos resueltos y fecha), con lectura y escritura protegidas; funciona sin él.
4. Sin conexión: service worker que guarda la página, el aula, la instantánea y el curso; modelo en `libro-python-es/app/sw.plantilla.js`. Prueba como `pruebas/offline.mjs` de ese repositorio.
5. Accesibilidad: todo con teclado, anuncio del resultado con `aria-live`, axe sin fallos; la terminal tiene alternativa de «leer la última salida».
6. `herramientas/construir.mjs` genera las páginas de `escuela/`; portada nueva del sitio que presenta la escuela y enlaza al emulador libre y al curso «Cómo funciona por dentro».

**Hecho cuando:** con el curso de muestra, la prueba de Playwright resuelve un reto tecleando la solución y ve «Reto superado»; lo mismo sin conexión; capturas de móvil y escritorio en el PR.

**PR:** `Add the classroom interface`.

### E1.2 Capítulos 1 a 4: 20 retos (Sonnet, medio)

Temario cerrado. Cada capítulo tiene un texto de 300 a 500 palabras y 5 retos.

1. **Dónde estoy:** `pwd`, `ls`, `cd`, rutas absolutas y relativas, `.` y `..`, `~`.
2. **Mirar archivos:** `cat`, `less`, `head`, `tail`, `wc`, `file`; archivos ocultos; `ls -l` leído columna a columna.
3. **Crear, copiar, mover, borrar:** `mkdir`, `touch`, `cp`, `mv`, `rm`, `rmdir`, opciones `-r` y `-i`; comodines `*` y `?`.
4. **Pedir ayuda y no perderse:** `--help`, historial, completar con Tab, `clear`, `echo`, comillas.

Los retos cuentan una historia continua (el alumno llega a un servidor desordenado y lo va arreglando); los archivos de cada reto se crean en `preparar`.

**Hecho cuando:** `npm run retos` y `node pruebas/estilo.mjs` pasan con los 20.

**PR:** `Terminal course: chapters 1 to 4`.

### E1.3 Capítulos 5 a 7: 15 retos (Sonnet, medio)

5. **Buscar:** `find` por nombre, tipo y tamaño; `grep` con `-i`, `-r`, `-n`, `-v`; primeras expresiones regulares.
6. **Tuberías y redirecciones:** `>`, `>>`, `<`, `|`, `sort`, `uniq`, `cut`, `tr`, `tee`; `2>` y `/dev/null`.
7. **Editar:** `vi` lo justo para sobrevivir (insertar, guardar, salir, borrar una línea, buscar); `sed` para sustituir.

**PR:** `Terminal course: chapters 5 to 7`.

### E1.4 Capítulos 8 a 10: 15 retos (Sonnet, medio)

8. **Permisos y usuarios:** `chmod` simbólico y numérico, `chown`, `id`, `su`, por qué `root` es peligroso.
9. **Procesos:** `ps`, `top`, `kill`, segundo plano con `&`, `jobs`, variables de entorno, `PATH`, `which`.
10. **Mi primer guion:** `#!/bin/sh`, variables, `if`, `for`, argumentos, hacerlo ejecutable; `tar` y `gzip`. Reto final que combina todo.

**PR:** `Terminal course: chapters 8 to 10`.

### E1.5 Revisión y publicación del curso 1 (Opus, alto)

**Pasos:** leer los 10 capítulos y los 50 retos como un alumno: cada orden se presentó antes de pedirla; ninguna comprobación acepta una solución equivocada evidente ni rechaza una alternativa razonable (probar 2 soluciones alternativas por reto en una muestra de 15); las pistas ayudan sin dar la respuesta hasta la última; ortografía. Presupuestos de tiempo y de peso. Arreglar aquí lo encontrado. Página de fin de curso con el diploma sencillo (generado en el dispositivo como imagen, con nombre escrito por el alumno y fecha). README y `CLAUDE.md` del repositorio actualizados.

**Hecho cuando:** todas las pruebas verdes y el curso publicado en el sitio.

**PR:** `Terminal course: review, certificate page and launch`.

---

### HILO C: curso 2, Python desde cero (60 retos)

- **E2.1 Máquina Python (Sonnet, medio).** `escuela/maquinas/python/`: Pyodide en un Worker (portar `app/src/worker.js` de `libro-python-es`, código MIT), con editor de código (un `textarea` con numeración y sangría con Tab; sin dependencias pesadas) y consola de salida. `comprobar` ejecuta el código del alumno y después un guion de comprobación en Python que puede mirar variables, funciones y la salida. Pyodide se baja solo al entrar en el curso y queda guardado. `pruebas/originalidad.mjs`: ninguna frase de más de 12 palabras de la escuela coincide con `libro-python-es` (se clona en la prueba). PR: `Add the Python machine`.
- **E2.2 Capítulos 1 a 4, 24 retos (Sonnet, medio).** Valores y variables; texto; decisiones; bucles. Proyecto guía: una libreta de gastos que crece en cada capítulo. PR: `Python course: chapters 1 to 4`.
- **E2.3 Capítulos 5 a 8, 24 retos (Sonnet, medio).** Listas; diccionarios; funciones; archivos y errores. PR: `Python course: chapters 5 to 8`.
- **E2.4 Capítulos 9 y 10, 12 retos, y revisión (Opus, alto, para la revisión).** Módulos de la biblioteca estándar; proyecto final. Revisión como E1.5. PR: `Python course: final chapters, review and launch`.

### HILO D: curso 3, SQL (45 retos)

- **E3.1 Máquina SQL (Sonnet, medio).** SQLite oficial en WebAssembly (paquete `@sqlite.org/sqlite-wasm`, dominio público; dependencia nueva permitida), en un Worker, con una consola `sqlite>` en xterm.js que acepta también las órdenes de punto (`.tables`, `.schema`). `preparar` carga una base de datos de ejemplo propia (una biblioteca municipal: socios, libros, préstamos; datos inventados, generados con semilla fija). `comprobar` compara el resultado de la última consulta del alumno, o el estado de las tablas, con el esperado, sin importar el orden cuando el reto no pide orden. PR: `Add the SQL machine`.
- **E3.2 Capítulos 1 a 4, 20 retos (Sonnet, medio).** `SELECT`, `WHERE`, `ORDER BY`, `LIMIT`; funciones y `NULL`; `GROUP BY` y `HAVING`; `JOIN`. PR: `SQL course: chapters 1 to 4`.
- **E3.3 Capítulos 5 a 7, 15 retos (Sonnet, medio).** Subconsultas; `INSERT`, `UPDATE`, `DELETE` y transacciones; `CREATE TABLE`, claves y restricciones. PR: `SQL course: chapters 5 to 7`.
- **E3.4 Capítulos 8 y 9, 10 retos, y revisión (Opus, alto, para la revisión).** Índices y `EXPLAIN`; diseño de una base de datos pequeña. PR: `SQL course: final chapters, review and launch`.

### HILO E: curso 4, Git (40 retos)

### E4.0 Prueba de viabilidad: Linux con MMU (Opus, medio)

**Objetivo:** saber si el emulador puede arrancar un Linux normal, donde Git y las redes funcionan.

**Pasos:**

1. En `src/cpu.ts` y el motor rápido: modo supervisor, CSR de supervisor, delegación de trampas, traducción de direcciones Sv32 con una TLB pequeña, `SFENCE.VMA`, y lo que el kernel exija de SBI (implementado en el propio emulador como llamadas de entorno). Los riscv-tests de modo supervisor (`rv32si-p-*`) y los de memoria virtual (`rv32ui-v-*`) se añaden a `./score`.
2. Segunda imagen (`imagen/mmu/`): buildroot para RV32 con MMU, musl, busybox y `git` (sin Perl ni Python; solo las órdenes de núcleo), con el mismo agente.
3. Medir: tiempo de arranque, tiempo de `git init && git add . && git commit` en un repositorio de 20 archivos, tamaño de la instantánea.

**Hecho cuando:** `./score` pasa con los tests nuevos y, en Node, esa secuencia de Git termina en menos de 3 s con el motor rápido; instantánea por debajo de 15 MB. La máquina sin MMU no se toca ni se frena (prueba de rendimiento existente).

**Plan B** (si falla dos veces o no entra en los presupuestos): `escuela/maquinas/git/` con libgit2 compilado a WebAssembly (`wasm-git`, licencia GPL-2.0 con excepción de enlace: comprobarla y citarla) detrás de una terminal propia que entiende `git …` y las órdenes de archivos básicas sobre un sistema de archivos en memoria. Se dice con claridad en el curso que es Git real sobre una terminal reducida. El curso de Redes pasa entonces a depender de una decisión nueva, que se escribe en `ESCUELA-PROGRESS.md` con su recomendación.

**PR:** `Add supervisor mode and Sv32 to the emulator` (o `Add a Git machine on libgit2`).

- **E4.1 Máquina Git (Opus, medio).** Adaptador `escuela/maquinas/git/` sobre la imagen con MMU, con su instantánea; `preparar` crea repositorios con historia a medida (guiones de Git con fechas y autores fijos); un «remoto» local en otra carpeta para practicar `clone`, `push` y `pull` sin red; panel opcional que dibuja el grafo de commits leyendo `git log --graph` por el canal. PR: `Add the Git machine`.
- **E4.2 Capítulos 1 a 4, 20 retos (Sonnet, medio).** Qué es un commit; `add` y `commit`; ver la historia (`log`, `diff`, `show`); deshacer (`restore`, `reset`, `revert`). PR: `Git course: chapters 1 to 4`.
- **E4.3 Capítulos 5 a 7, 15 retos (Sonnet, medio).** Ramas y `merge`; conflictos resueltos a mano; remotos, `clone`, `push`, `pull`. PR: `Git course: chapters 5 to 7`.
- **E4.4 Capítulo 8, 5 retos, y revisión (Opus, alto, para la revisión).** Flujo de trabajo de un PR simulado con el remoto local; `rebase` básico; `stash`. PR: `Git course: final chapter, review and launch`.

### HILO F: curso 5, Redes (35 retos)

- **E5.1 Dos máquinas conectadas (Opus, medio).** Dispositivo de red mínimo en el emulador (virtio-net si el kernel de la imagen con MMU lo trae; si no, una interfaz serie con SLIP sobre un tercer UART) y un «cable» en JavaScript que une dos instancias del emulador en dos Workers y puede retrasar, perder o capturar paquetes. Imagen con `ip`, `ping`, `nc`, `traceroute`, `nslookup`, un servidor web y un servidor DNS diminutos de busybox. El aula muestra dos terminales y un panel con los paquetes que pasan. Nada sale a internet. Presupuesto: dos máquinas a la vez en el móvil frenado sin bajar de la mitad de la velocidad de una sola. PR: `Connect two guests with a virtual cable`.
- **E5.2 Capítulos 1 a 3, 15 retos (Sonnet, medio).** Direcciones y máscaras; `ping` y rutas; puertos, TCP y UDP con `nc`. PR: `Networking course: chapters 1 to 3`.
- **E5.3 Capítulos 4 a 6, 15 retos (Sonnet, medio).** DNS; HTTP a mano; diagnosticar una red rota (retos donde `preparar` estropea algo). PR: `Networking course: chapters 4 to 6`.
- **E5.4 Capítulo 7, 5 retos, y revisión (Opus, alto, para la revisión).** Cortafuegos básico y cierre. PR: `Networking course: final chapter, review and launch`.

### HILO G: lanzamiento, aula, libros y Pro

- **E6.1 Modo aula (Sonnet, medio).** Exportar e importar el progreso como archivo; página «Para docentes» con la guía de uso en un aula sin internet (copiar el sitio a una memoria USB y servirlo en la red local) y la hoja de soluciones; paquete `escuela-sin-conexion.zip` como archivo de release.
- **E6.2 Guías y portada (Sonnet, medio).** Seis guías que responden búsquedas reales (aprender Linux desde cero, practicar SQL en línea sin instalar, y similares), con `sitemap.xml` y datos estructurados de curso; ficha en el catálogo de github.io.
- **E6.3 Vídeos para X (Sonnet, medio).** Uno por curso, grabado con Playwright sobre el sitio real. Publicar solo con OK.
- **E6.4 Libros (Sonnet, medio).** `herramientas/libro.py` convierte cada curso a un libro con Book Studio (PDF de KDP y EPUB), con los retos como ejercicios y las soluciones al final. Se guardan en `/mnt/project-files/apuestas/escuela/libros/`. Subirlos a KDP es de Enrique y es venta: congelado.
- **E6.5 Pro apagado (Sonnet, medio; plan primero con Opus, alto).** Plan del primer curso avanzado y del certificado verificable (examen con retos nuevos sorteados y comprobante firmado por el servicio de pago), sin construir nada visible. Documento en `docs/ESCUELA-PRO.md`.
