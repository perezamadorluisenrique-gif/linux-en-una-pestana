// El motor rápido: el mismo bucle "fetch, decodifica, ejecuta" de cpu.ts, pero escrito como
// una función WebAssembly (generada aquí, desde TypeScript, con el ensamblador de wasm.ts).
//
// ¿Por qué es más rápido? En JavaScript cada acceso a `x[rd]` o a la RAM comprueba límites y
// tipos, y V8 tiene que adivinar que todo son enteros de 32 bits. En WebAssembly los enteros de
// 32 bits son el tipo nativo y la RAM es la memoria lineal del módulo: una carga RISC-V es una
// carga de la máquina. Capítulo 8 del curso.
//
// El motor rápido solo sabe hacer el caso común: cálculo (RV32IM), saltos y cargas/stores
// que caen en la RAM. Ante cualquier otra cosa (SYSTEM, atómicas, E/S, un fallo, una
// codificación rara) se detiene sin ejecutarla y la CPU en TypeScript ejecuta esa instrucción.
//
// Memoria lineal: [0, ramSize) es la RAM de la máquina; a continuación vienen los 32 registros
// y un pequeño bloque de estado (pc, reserva de LR/SC). TypeScript ve lo mismo con vistas tipadas.

import { Code, I32, moduleWithFunction, OP } from "./wasm.ts";

/** Desplazamientos (en bytes, a partir de ramSize) de los registros y del estado. */
export const REGS = 0;
export const STATE_PC = 128;
export const STATE_RESV = 132;
export const EXTRA_BYTES = 256;

export interface FastCore {
  /** Ejecuta hasta `budget` instrucciones desde `pc`. Devuelve cuántas. El pc final queda en memoria. */
  run(pc: number, budget: number): number;
}

// Locales de la función (los dos primeros son los parámetros).
const PC = 0, BUDGET = 1, N = 2, INSN = 3, A = 4, B = 5, V = 6, NEXT = 7, ADDR = 8, OFF = 9, T = 10, SW = 11;

export function buildFastCore(memory: WebAssembly.Memory, ramBase: number, ramSize: number): FastCore {
  const XB = ramSize + REGS; // dirección de x0
  const RB = ramBase | 0;
  const c = new Code(SW);

  // Atajos: valor de un campo de la instrucción.
  const funct3 = () => c.get(INSN).i32(12).op(OP.i32ShrU).i32(7).op(OP.i32And);
  const funct7 = () => c.get(INSN).i32(25).op(OP.i32ShrU);
  const immI = () => c.get(INSN).i32(20).op(OP.i32ShrS);
  // rd/rs1/rs2 * 4 (dirección del registro relativa a XB)
  const rdX4 = () => c.get(INSN).i32(5).op(OP.i32ShrU).i32(124).op(OP.i32And);
  /** v = expr; ir a escribir rd. */
  const write = (expr: () => void) => { expr(); c.set(V).br("write"); };
  const slow = () => { c.br("slow"); };
  /** Salta si la condición de la pila es cierta a "slow". */
  const slowIf = () => { c.brIf("slow"); };
  const offOf = () => c.get(ADDR).i32(RB).op(OP.i32Sub).set(OFF);

  c.block("exit");
  c.loop("top");
  // ¿Se acabó el presupuesto? Sale con el pc de la siguiente instrucción sin ejecutar.
  c.get(N).get(BUDGET).op(OP.i32GeU).brIf("exit");
  c.block("advance");
  c.block("write");
  c.block("slow");
  // Fetch (si el pc está fuera de la RAM, que lo resuelva la ruta lenta: fallo de acceso).
  c.get(PC).i32(RB).op(OP.i32Sub).tee(OFF).i32(ramSize - 4).op(OP.i32GtU); slowIf();
  c.get(OFF).mem(OP.i32Load, 0, 2).tee(INSN).i32(3).op(OP.i32And).i32(3).op(OP.i32Ne); slowIf();
  c.get(PC).i32(4).op(OP.i32Add).set(NEXT);
  // Operandos: x[rs1] y x[rs2] (se leen siempre; es más barato que decidir si hacen falta).
  c.get(INSN).i32(13).op(OP.i32ShrU).i32(124).op(OP.i32And).mem(OP.i32Load, XB, 2).set(A);
  c.get(INSN).i32(18).op(OP.i32ShrU).i32(124).op(OP.i32And).mem(OP.i32Load, XB, 2).set(B);

  const cases: ((c: Code) => void)[] = new Array(29).fill(null).map(() => () => slow());

  cases[13] = () => write(() => c.get(INSN).i32(0xfffff000 | 0).op(OP.i32And)); // LUI
  cases[5] = () => write(() => c.get(PC).get(INSN).i32(0xfffff000 | 0).op(OP.i32And).op(OP.i32Add)); // AUIPC
  cases[27] = () => { // JAL
    // imm = ((insn >> 31) << 20) | (insn & 0xff000) | ((insn >>> 9) & 0x800) | ((insn >>> 20) & 0x7fe)
    c.get(INSN).i32(31).op(OP.i32ShrS).i32(20).op(OP.i32Shl);
    c.get(INSN).i32(0xff000).op(OP.i32And).op(OP.i32Or);
    c.get(INSN).i32(9).op(OP.i32ShrU).i32(0x800).op(OP.i32And).op(OP.i32Or);
    c.get(INSN).i32(20).op(OP.i32ShrU).i32(0x7fe).op(OP.i32And).op(OP.i32Or);
    c.get(PC).op(OP.i32Add).tee(T).i32(3).op(OP.i32And); slowIf();
    c.get(NEXT).set(V).get(T).set(NEXT).br("write");
  };
  cases[25] = () => { // JALR
    funct3(); slowIf();
    c.get(A); immI(); c.op(OP.i32Add).i32(-2).op(OP.i32And).tee(T).i32(3).op(OP.i32And); slowIf();
    c.get(NEXT).set(V).get(T).set(NEXT).br("write");
  };
  cases[24] = () => { // BRANCH
    const taken = (cmp: number) => () => {
      c.get(A).get(B).op(cmp).op(OP.i32Eqz).brIf("advance");
      // imm = ((insn >> 31) << 12) | ((insn << 4) & 0x800) | ((insn >>> 20) & 0x7e0) | ((insn >>> 7) & 0x1e)
      c.get(INSN).i32(31).op(OP.i32ShrS).i32(12).op(OP.i32Shl);
      c.get(INSN).i32(4).op(OP.i32Shl).i32(0x800).op(OP.i32And).op(OP.i32Or);
      c.get(INSN).i32(20).op(OP.i32ShrU).i32(0x7e0).op(OP.i32And).op(OP.i32Or);
      c.get(INSN).i32(7).op(OP.i32ShrU).i32(0x1e).op(OP.i32And).op(OP.i32Or);
      c.get(PC).op(OP.i32Add).tee(T).i32(3).op(OP.i32And); slowIf();
      c.get(T).set(NEXT).br("advance");
    };
    funct3();
    c.switch([taken(OP.i32Eq), taken(OP.i32Ne), slow, slow, taken(OP.i32LtS), taken(OP.i32GeS),
      taken(OP.i32LtU), taken(OP.i32GeU)], slow);
  };
  cases[0] = () => { // LOAD
    c.get(A); immI(); c.op(OP.i32Add).set(ADDR); offOf();
    const ld = (limit: number, opcode: number) => () => {
      c.get(OFF).i32(limit).op(OP.i32GtU); slowIf();
      write(() => c.get(OFF).mem(opcode, 0, 0));
    };
    funct3();
    c.switch([ld(ramSize - 1, OP.i32Load8S), ld(ramSize - 2, OP.i32Load16S), ld(ramSize - 4, OP.i32Load), slow,
      ld(ramSize - 1, OP.i32Load8U), ld(ramSize - 2, OP.i32Load16U)], slow);
  };
  cases[8] = () => { // STORE
    // imm = ((insn >> 25) << 5) | ((insn >>> 7) & 31)
    c.get(A).get(INSN).i32(25).op(OP.i32ShrS).i32(5).op(OP.i32Shl)
      .get(INSN).i32(7).op(OP.i32ShrU).i32(31).op(OP.i32And).op(OP.i32Or).op(OP.i32Add).set(ADDR);
    offOf();
    const st = (limit: number, opcode: number) => () => {
      c.get(OFF).i32(limit).op(OP.i32GtU); slowIf();
      c.get(OFF).get(B).mem(opcode, 0, 0);
      // Una escritura a la palabra reservada por LR rompe la reserva.
      c.i32(0).mem(OP.i32Load, ramSize + STATE_RESV, 2).get(ADDR).i32(-4).op(OP.i32And).op(OP.i32Eq);
      c.if().i32(0).i32(-1).mem(OP.i32Store, ramSize + STATE_RESV, 2).end();
      c.br("advance");
    };
    funct3();
    c.switch([st(ramSize - 1, OP.i32Store8), st(ramSize - 2, OP.i32Store16), st(ramSize - 4, OP.i32Store)], slow);
  };
  cases[4] = () => { // OP-IMM
    const alu = (f: () => void) => () => write(f);
    funct3();
    c.switch([
      alu(() => { c.get(A); immI(); c.op(OP.i32Add); }),
      () => { funct7(); slowIf(); write(() => { c.get(A); immI(); c.op(OP.i32Shl); }); }, // SLLI
      alu(() => { c.get(A); immI(); c.op(OP.i32LtS); }),
      alu(() => { c.get(A); immI(); c.op(OP.i32LtU); }),
      alu(() => { c.get(A); immI(); c.op(OP.i32Xor); }),
      () => { // SRLI / SRAI
        funct7(); c.op(OP.i32Eqz);
        c.if(); write(() => { c.get(A); immI(); c.op(OP.i32ShrU); }); c.end();
        funct7(); c.i32(0x20).op(OP.i32Ne); slowIf();
        write(() => { c.get(A); immI(); c.op(OP.i32ShrS); });
      },
      alu(() => { c.get(A); immI(); c.op(OP.i32Or); }),
      alu(() => { c.get(A); immI(); c.op(OP.i32And); }),
    ], slow);
  };
  cases[12] = () => { // OP (y extensión M)
    const ab = (opcode: number) => () => write(() => c.get(A).get(B).op(opcode));
    const hi = (sa: boolean, sb: boolean, shr: number) => () => write(() => {
      c.get(A).op(sa ? OP.i64ExtendI32S : OP.i64ExtendI32U).get(B).op(sb ? OP.i64ExtendI32S : OP.i64ExtendI32U);
      c.op(OP.i64Mul).op(0x42, 32).op(shr).op(OP.i32WrapI64); // 0x42 = i64.const
    });
    const bZero = () => c.get(B).op(OP.i32Eqz);
    funct7(); c.op(OP.i32Eqz);
    c.if();
    funct3(); c.switch([ab(OP.i32Add), ab(OP.i32Shl), ab(OP.i32LtS), ab(OP.i32LtU), ab(OP.i32Xor),
      ab(OP.i32ShrU), ab(OP.i32Or), ab(OP.i32And)], slow);
    c.end();
    funct7(); c.i32(0x20).op(OP.i32Eq);
    c.if();
    funct3(); c.switch([ab(OP.i32Sub), slow, slow, slow, slow, ab(OP.i32ShrS)], slow);
    c.end();
    funct7(); c.i32(1).op(OP.i32Ne); slowIf();
    funct3();
    c.switch([
      ab(OP.i32Mul), hi(true, true, OP.i64ShrS), hi(true, false, OP.i64ShrS), hi(false, false, OP.i64ShrU),
      () => { // DIV: /0 da -1; -2^31 / -1 da -2^31 (en wasm, div_s atraparía)
        bZero(); c.if(); write(() => c.i32(-1)); c.end();
        c.get(B).i32(-1).op(OP.i32Eq); c.if(); write(() => c.i32(0).get(A).op(OP.i32Sub)); c.end();
        write(() => c.get(A).get(B).op(OP.i32DivS));
      },
      () => { bZero(); c.if(); write(() => c.i32(-1)); c.end(); write(() => c.get(A).get(B).op(OP.i32DivU)); },
      () => { // REM: %0 da el dividendo; x % -1 = 0
        bZero(); c.if(); write(() => c.get(A)); c.end();
        c.get(B).i32(-1).op(OP.i32Eq); c.if(); write(() => c.i32(0)); c.end();
        write(() => c.get(A).get(B).op(OP.i32RemS));
      },
      () => { bZero(); c.if(); write(() => c.get(A)); c.end(); write(() => c.get(A).get(B).op(OP.i32RemU)); },
    ], slow);
  };
  cases[3] = () => { funct3(); c.i32(1).op(OP.i32GtU); slowIf(); c.br("advance"); }; // FENCE, FENCE.I

  // Grupo de la instrucción: bits 6..2.
  c.get(INSN).i32(2).op(OP.i32ShrU).i32(31).op(OP.i32And);
  c.switch(cases, slow);
  c.end(); // slow: guarda el pc de la instrucción que no sabemos hacer y sale
  c.br("exit");
  c.end(); // write: x[rd] = v; x0 vuelve a 0
  rdX4(); c.get(V).mem(OP.i32Store, XB, 2);
  c.i32(0).i32(0).mem(OP.i32Store, XB, 2);
  c.end(); // advance
  c.get(NEXT).set(PC);
  c.get(N).i32(1).op(OP.i32Add).set(N);
  c.br("top");
  c.end(); // top
  c.end(); // exit
  c.i32(0).get(PC).mem(OP.i32Store, ramSize + STATE_PC, 2);
  c.get(N);

  const bytes = moduleWithFunction({
    exportName: "run", params: [I32, I32], results: [I32],
    locals: [I32, I32, I32, I32, I32, I32, I32, I32, I32, I32], memoryPages: memory.buffer.byteLength >>> 16, body: c,
  });
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  return { run: inst.exports.run as (pc: number, budget: number) => number };
}
