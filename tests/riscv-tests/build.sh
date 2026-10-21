#!/usr/bin/env bash
# Compila los riscv-tests (rv32ui, rv32um, rv32ua, rv32mi; entorno "p") con clang + ld.lld.
# Uso: bash tests/riscv-tests/build.sh   -> deja los ELF en build/riscv-tests/
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/build/src"
OUT="$ROOT/build/riscv-tests"
# Commits fijados para que el resultado sea reproducible.
TESTS_COMMIT=3df703cd52d5f0d8224e3c50bf03c6cb70efff98
ENV_COMMIT=a1c373ec89a3500630bafabf406108a8fc568bcc

fetch() { # repo dir commit
  if [ ! -d "$2/.git" ]; then
    git init -q "$2"
    git -C "$2" remote add origin "$1"
  fi
  if [ "$(git -C "$2" rev-parse HEAD 2>/dev/null)" != "$3" ]; then
    git -C "$2" fetch -q --depth 1 origin "$3"
    git -C "$2" checkout -q FETCH_HEAD
  fi
}
mkdir -p "$SRC" "$OUT"
fetch https://github.com/riscv-software-src/riscv-tests "$SRC/riscv-tests" $TESTS_COMMIT
fetch https://github.com/riscv/riscv-test-env "$SRC/riscv-test-env" $ENV_COMMIT

# El ensamblador de LLVM no acepta ".weak x" seguido de ".globl x" (GNU as sí): en una copia
# del árbol quitamos los ".global mtvec_handler" (la definición queda débil, que funciona igual)
# y cambiamos el nombre "tcontrol", que LLVM 18 no conoce, por su número (0x7a5).
ISA="$ROOT/build/isa-patched"
rm -rf "$ISA"; cp -r "$SRC/riscv-tests/isa" "$ISA"
grep -rlE '\.globa?l? +[ms]tvec_handler|tcontrol' "$ISA" | xargs sed -i -E \
  -e 's/^\s*\.globa?l?\s+[ms]tvec_handler.*$//' -e 's/\btcontrol\b/0x7a5/g'
ENV="$SRC/riscv-test-env"
# ld.lld no entiende FLAGS(SHF_ALLOC | SHF_EXECINSTR) del link.ld original: lo cambiamos por PF_R|PF_X.
sed 's/FLAGS(SHF_ALLOC | SHF_EXECINSTR)/FLAGS(5)/' "$ENV/p/link.ld" > "$OUT/link.ld"

CFLAGS=(--target=riscv32 -march=rv32ima_zicsr_zifencei -mabi=ilp32 -mno-relax -static
  -mcmodel=medany -fvisibility=hidden -nostdlib -fuse-ld=lld
  -I"$ENV/p" -I"$ISA/macros/scalar" -T "$OUT/link.ld")

n=0
for suite in rv32ui rv32um rv32ua rv32mi; do
  # La lista de tests sale de la variable <suite>_sc_tests del Makefrag, leída con awk
  # (sin ejecutar el Makefile del repositorio descargado).
  tests=$(awk -v v="${suite}_sc_tests" '$1==v{f=1} f{for(i=1;i<=NF;i++) if($i!="\\" && $i!="=" && $i!=v) print $i; if($NF!="\\") f=0}' "$ISA/$suite/Makefrag")
  for t in $tests; do
    clang "${CFLAGS[@]}" "$ISA/$suite/$t.S" -o "$OUT/$suite-p-$t" 2>"$OUT/$suite-p-$t.log" \
      || { echo "FALLO al compilar $suite-p-$t (ver $OUT/$suite-p-$t.log)"; continue; }
    rm -f "$OUT/$suite-p-$t.log"
    n=$((n + 1))
  done
done
echo "$n tests compilados en $OUT"
