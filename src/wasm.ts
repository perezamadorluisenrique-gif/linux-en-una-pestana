// Un ensamblador mínimo de WebAssembly: lo justo para escribir una función a mano desde TypeScript.
//
// Un módulo .wasm es una lista de secciones (tipos, importaciones, funciones, exportaciones,
// código); cada instrucción es un byte de código de operación seguido de sus inmediatos en LEB128.
// Las etiquetas de salto de WebAssembly son profundidades relativas ("sal al bloque que me
// rodea 3 niveles más afuera"); aquí se les da nombre y el ensamblador calcula la profundidad.
// Capítulo 8 del curso.

/** Entero sin signo en LEB128. */
export function uleb(n: number): number[] {
  const out: number[] = [];
  n >>>= 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

/** Entero con signo en LEB128. */
export function sleb(n: number): number[] {
  const out: number[] = [];
  n |= 0;
  for (;;) {
    const b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && (b & 0x40) === 0) || (n === -1 && (b & 0x40) !== 0)) { out.push(b); return out; }
    out.push(b | 0x80);
  }
}

const name = (s: string) => [...uleb(s.length), ...new TextEncoder().encode(s)];
const section = (id: number, body: number[]) => [id, ...uleb(body.length), ...body];

export const I32 = 0x7f;
export const I64 = 0x7e;
const VOID = 0x40;

/** Códigos de operación que usamos (especificación de WebAssembly 1.0, §5.4). */
export const OP = {
  unreachable: 0x00, block: 0x02, loop: 0x03, if: 0x04, else: 0x05, end: 0x0b, br: 0x0c, brIf: 0x0d,
  brTable: 0x0e, return: 0x0f, drop: 0x1a, select: 0x1b,
  localGet: 0x20, localSet: 0x21, localTee: 0x22,
  i32Load: 0x28, i32Load8S: 0x2c, i32Load8U: 0x2d, i32Load16S: 0x2e, i32Load16U: 0x2f,
  i32Store: 0x36, i32Store8: 0x3a, i32Store16: 0x3b,
  i32Const: 0x41,
  i32Eqz: 0x45, i32Eq: 0x46, i32Ne: 0x47, i32LtS: 0x48, i32LtU: 0x49, i32GtS: 0x4a, i32GtU: 0x4b,
  i32LeS: 0x4c, i32LeU: 0x4d, i32GeS: 0x4e, i32GeU: 0x4f,
  i32Add: 0x6a, i32Sub: 0x6b, i32Mul: 0x6c, i32DivS: 0x6d, i32DivU: 0x6e, i32RemS: 0x6f, i32RemU: 0x70,
  i32And: 0x71, i32Or: 0x72, i32Xor: 0x73, i32Shl: 0x74, i32ShrS: 0x75, i32ShrU: 0x76,
  i64Mul: 0x7e, i64ShrS: 0x87, i64ShrU: 0x88,
  i32WrapI64: 0xa7, i64ExtendI32S: 0xac, i64ExtendI32U: 0xad,
} as const;

/** Constructor del cuerpo de una función, con etiquetas con nombre. */
export class Code {
  readonly bytes: number[] = [];
  private readonly labels: string[] = [];
  /** `scratch`: un local i32 libre que usa `switch` para guardar el índice. */
  private readonly scratch: number;
  constructor(scratch: number) { this.scratch = scratch; }

  op(...b: number[]): this { this.bytes.push(...b); return this; }
  get(l: number): this { return this.op(OP.localGet, ...uleb(l)); }
  set(l: number): this { return this.op(OP.localSet, ...uleb(l)); }
  tee(l: number): this { return this.op(OP.localTee, ...uleb(l)); }
  i32(n: number): this { return this.op(OP.i32Const, ...sleb(n)); }
  /** Acceso a memoria: `offset` se suma a la dirección de la pila (sin coste). */
  mem(opcode: number, offset = 0, align = 0): this { return this.op(opcode, align, ...uleb(offset)); }

  block(label: string): this { this.labels.push(label); return this.op(OP.block, VOID); }
  loop(label: string): this { this.labels.push(label); return this.op(OP.loop, VOID); }
  /** `if` sin valor; su etiqueta solo sirve para `end`. */
  if(): this { this.labels.push(""); return this.op(OP.if, VOID); }
  else(): this { return this.op(OP.else); }
  end(): this { this.labels.pop(); return this.op(OP.end); }

  private depth(label: string): number {
    const i = this.labels.lastIndexOf(label);
    if (i < 0) throw new Error(`etiqueta desconocida: ${label}`);
    return this.labels.length - 1 - i;
  }
  br(label: string): this { return this.op(OP.br, ...uleb(this.depth(label))); }
  brIf(label: string): this { return this.op(OP.brIf, ...uleb(this.depth(label))); }

  /**
   * `switch` sobre el valor de la pila (0..cases.length-1; el resto va a `dflt`).
   * Cada caso debe terminar con un salto (`br`) a una etiqueta exterior.
   */
  switch(cases: ((c: this) => void)[], dflt: (c: this) => void): this {
    const n = cases.length;
    const id = `sw${this.bytes.length}`;
    // Un bloque no ve la pila de fuera: el índice pasa por un local.
    this.set(this.scratch);
    for (let i = n; i >= 0; i--) this.block(`${id}_${i}`); // el más interior es el caso 0
    this.get(this.scratch);
    this.op(OP.brTable, ...uleb(n), ...cases.flatMap((_, i) => uleb(i)), ...uleb(n));
    for (let i = 0; i < n; i++) { this.end(); cases[i](this); }
    this.end();
    dflt(this);
    return this;
  }
}

/** Un módulo con una memoria importada (`env.memory`) y una función exportada. */
export function moduleWithFunction(opts: {
  exportName: string; params: number[]; results: number[]; locals: number[];
  memoryPages: number; body: Code;
}): Uint8Array {
  const type = [0x60, ...uleb(opts.params.length), ...opts.params, ...uleb(opts.results.length), ...opts.results];
  const groups: number[] = [];
  for (const t of opts.locals) groups.push(1, t);
  const func = [...uleb(opts.locals.length), ...groups, ...opts.body.bytes, OP.end];
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, [1, ...type]),
    ...section(2, [1, ...name("env"), ...name("memory"), 0x02, 0x00, ...uleb(opts.memoryPages)]),
    ...section(3, [1, 0]),
    ...section(7, [1, ...name(opts.exportName), 0x00, 0]),
    ...section(10, [1, ...uleb(func.length), ...func]),
  ]);
}
