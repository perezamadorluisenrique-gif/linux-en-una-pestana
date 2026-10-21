# Licencias

Este repositorio reúne tres cosas con licencias distintas.

## 1. El emulador y las herramientas: MIT

Todo el código (`src/`, `node/`, `web/`, `tests/`, `tools/`, `herramientas/`, `pruebas/`, `sitio/`, `setup.sh`, `score`):

```
MIT License

Copyright (c) 2026 Siulved54

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. El curso (`curso/`): CC BY 4.0

© 2026 Siulved54. El texto del curso se publica bajo
[Creative Commons Atribución 4.0 Internacional](https://creativecommons.org/licenses/by/4.0/deed.es):
puedes copiarlo, adaptarlo y redistribuirlo, también con fines comerciales, citando la autoría y
enlazando a este repositorio. Los fragmentos de código que cita son parte del emulador (MIT).

## 3. La imagen de Linux: GPL (no está en el repositorio)

La página arranca la imagen `linux-6.1.14-rv32nommu-cnl-1` de
[cnlohr/mini-rv32ima-images](https://github.com/cnlohr/mini-rv32ima-images): el kernel Linux 6.1.14
(GPL-2.0) con un initramfs de busybox (GPL-2.0). El repositorio no la incluye: la descarga
`herramientas/obtener-imagen.sh` (o `setup.sh`), comprueba su SHA-256 y el sitio web la sirve sin
modificar como fichero `Image`.

Fuentes correspondientes:

- Kernel: https://cdn.kernel.org/pub/linux/kernel/v6.x/linux-6.1.14.tar.xz
- Configuración del kernel, busybox y buildroot de la imagen: https://github.com/cnlohr/mini-rv32ima/tree/master/configs
- Buildroot usado: https://github.com/cnlohr/buildroot

El detalle de todo lo de terceros (riscv-tests, xterm.js, esbuild, Playwright…) está en [CREDITOS.md](CREDITOS.md).
El sitio web usa además `marked` (MIT, para convertir el curso a HTML) y `axe-core` (MPL-2.0, solo en las pruebas).
