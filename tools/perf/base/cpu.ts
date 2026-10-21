// La CPU: un hart RV32IMA con modos máquina (M) y usuario (U), sin MMU.
//
// Todo el procesador es un bucle: leer la instrucción en `pc`, decodificarla,
// ejecutarla y pasar a la siguiente. El resto (CSR, traps, interrupciones) son
// excepciones a ese bucle. Capítulos 1 a 5 del curso.

import { Bus, BusError } from "./bus.ts";

// Causas de excepción (campo mcause, privileged spec §3.1.15).
export const CAUSE = {
  MISALIGNED_FETCH: 0,
  FETCH_ACCESS: 1,
  ILLEGAL_INSTRUCTION: 2,
  BREAKPOINT: 3,
  MISALIGNED_LOAD: 4,
  LOAD_ACCESS: 5,
  MISALIGNED_STORE: 6,
  STORE_ACCESS: 7,
  ECALL_U: 8,
  ECALL_M: 11,
} as const;

// Bits de interrupción en mip/mie. El bit 31 de mcause marca "es una interrupción".
export const IRQ = { MSI: 3, MTI: 7, MEI: 11 } as const;

const PRIV_U = 0;
const PRIV_M = 3;

// Bits de mstatus que implementamos.
const MSTATUS_MIE = 1 << 3;
const MSTATUS_MPIE = 1 << 7;
const MSTATUS_MPP = 3 << 11;
const MSTATUS_MPRV = 1 << 17;
const MSTATUS_TW = 1 << 21;
const MSTATUS_MASK = MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP | MSTATUS_MPRV | MSTATUS_TW;

// misa: MXL=1 (32 bits) y las extensiones A, I, M, U.
const MISA = (1 << 30) | (1 << 0) | (1 << 8) | (1 << 12) | (1 << 20);

/** Una excepción síncrona en curso. La lanzan los accesos a memoria y el decodificador. */
export class Trap {
  readonly cause: number;
  readonly tval: number;
  constructor(cause: number, tval: number) {
    this.cause = cause;
    this.tval = tval | 0;
  }
}

/** Producto alto sin signo de dos enteros de 32 bits, sin BigInt (trozos de 16 bits). */
export function mulhu(a: number, b: number): number {
  a >>>= 0;
  b >>>= 0;
  const al = a & 0xffff, ah = a >>> 16, bl = b & 0xffff, bh = b >>> 16;
  const ll = al * bl, lh = al * bh, hl = ah * bl, hh = ah * bh;
  const mid = (ll >>> 16) + (lh & 0xffff) + (hl & 0xffff);
  return (hh + (lh >>> 16) + (hl >>> 16) + Math.floor(mid / 65536)) | 0;
}
export function mulh(a: number, b: number): number {
  let r = mulhu(a, b);
  if (a < 0) r = (r - b) | 0;
  if (b < 0) r = (r - a) | 0;
  return r;
}
export function mulhsu(a: number, b: number): number {
  let r = mulhu(a, b);
  if (a < 0) r = (r - b) | 0;
  return r;
}

export class CPU {
  /** Registros enteros x0..x31. Int32Array: la aritmética de 32 bits sale gratis. */
  readonly x = new Int32Array(32);
  pc = 0;
  priv = PRIV_M;
  readonly bus: Bus;

  // CSR de máquina.
  mstatus = 0;
  mie = 0;
  mip = 0;
  mtvec = 0;
  mscratch = 0;
  mepc = 0;
  mcause = 0;
  mtval = 0;
  mcounteren = 0;
  readonly pmpcfg = new Int32Array(4);
  readonly pmpaddr = new Int32Array(16);

  /** Instrucciones retiradas (minstret) y ciclos (mcycle): un ciclo por instrucción. */
  instret = 0;
  cycle = 0;
  /** Reloj de pared del CLINT, para el CSR `time`. Lo conecta la máquina. */
  readTime: () => number = () => 0;

  /** Reserva de LR/SC: dirección reservada o -1. */
  reservation = -1;
  /** true tras WFI: la máquina deja de ejecutar hasta que llegue una interrupción. */
  waiting = false;

  constructor(bus: Bus) {
    this.bus = bus;
  }

  reset(pc: number): void {
    this.x.fill(0);
    this.pc = pc | 0;
    this.priv = PRIV_M;
    this.mstatus = 0;
    this.mie = this.mip = 0;
    this.waiting = false;
    this.reservation = -1;
  }

  // ---------------------------------------------------------------- memoria
  // La ruta rápida comprueba si la dirección cae en la RAM y usa el DataView;
  // si no, va al bus (dispositivos). Un fallo del bus se convierte en Trap.

  load32(addr: number): number {
    const off = (addr - this.bus.ramBase) >>> 0;
    if (off <= this.bus.ramSize - 4) return this.bus.view.getInt32(off, true);
    if ((addr & 3) !== 0) throw new Trap(CAUSE.MISALIGNED_LOAD, addr);
    return this.io(addr, 4, CAUSE.LOAD_ACCESS) | 0;
  }
  load16(addr: number): number {
    const off = (addr - this.bus.ramBase) >>> 0;
    if (off <= this.bus.ramSize - 2) return this.bus.view.getUint16(off, true);
    if ((addr & 1) !== 0) throw new Trap(CAUSE.MISALIGNED_LOAD, addr);
    return this.io(addr, 2, CAUSE.LOAD_ACCESS) & 0xffff;
  }
  load8(addr: number): number {
    const off = (addr - this.bus.ramBase) >>> 0;
    if (off < this.bus.ramSize) return this.bus.ram[off];
    return this.io(addr, 1, CAUSE.LOAD_ACCESS) & 0xff;
  }
  store32(addr: number, v: number): void {
    const off = (addr - this.bus.ramBase) >>> 0;
    if (off <= this.bus.ramSize - 4) { this.bus.view.setInt32(off, v, true); return; }
    if ((addr & 3) !== 0) throw new Trap(CAUSE.MISALIGNED_STORE, addr);
    this.ioWrite(addr, v, 4);
  }
  store16(addr: number, v: number): void {
    const off = (addr - this.bus.ramBase) >>> 0;
    if (off <= this.bus.ramSize - 2) { this.bus.view.setUint16(off, v & 0xffff, true); return; }
    if ((addr & 1) !== 0) throw new Trap(CAUSE.MISALIGNED_STORE, addr);
    this.ioWrite(addr, v, 2);
  }
  store8(addr: number, v: number): void {
    const off = (addr - this.bus.ramBase) >>> 0;
    if (off < this.bus.ramSize) { this.bus.ram[off] = v; return; }
    this.ioWrite(addr, v, 1);
  }

  private io(addr: number, width: number, cause: number): number {
    try {
      return this.bus.readIO(addr, width);
    } catch (e) {
      if (e instanceof BusError) throw new Trap(cause, addr);
      throw e;
    }
  }
  private ioWrite(addr: number, v: number, width: number): void {
    try {
      this.bus.writeIO(addr, v, width);
    } catch (e) {
      if (e instanceof BusError) throw new Trap(CAUSE.STORE_ACCESS, addr);
      throw e;
    }
  }

  // ---------------------------------------------------------------- traps

  /** Entra en un trap: guarda pc y causa, desactiva interrupciones y salta a mtvec. */
  trap(cause: number, tval: number, isInterrupt: boolean): void {
    this.mepc = this.pc;
    this.mcause = isInterrupt ? (cause | 0x80000000) : cause;
    this.mtval = isInterrupt ? 0 : tval;
    const mie = (this.mstatus & MSTATUS_MIE) !== 0;
    this.mstatus = (this.mstatus & ~(MSTATUS_MPIE | MSTATUS_MIE | MSTATUS_MPP))
      | (mie ? MSTATUS_MPIE : 0) | (this.priv << 11);
    this.priv = PRIV_M;
    const base = this.mtvec & ~3;
    // Modo vectorizado (mtvec[0]=1): las interrupciones saltan a base + 4*causa.
    this.pc = (isInterrupt && (this.mtvec & 1)) ? (base + 4 * cause) | 0 : base;
    this.reservation = -1;
  }

  /** ¿Hay una interrupción pendiente, habilitada y no enmascarada? Devuelve su número o -1. */
  pendingInterrupt(): number {
    const pending = this.mip & this.mie;
    if (pending === 0) return -1;
    if (this.priv === PRIV_M && (this.mstatus & MSTATUS_MIE) === 0) return -1;
    // Prioridad: externa > software > temporizador.
    if (pending & (1 << IRQ.MEI)) return IRQ.MEI;
    if (pending & (1 << IRQ.MSI)) return IRQ.MSI;
    if (pending & (1 << IRQ.MTI)) return IRQ.MTI;
    return -1;
  }

  /** Atiende una interrupción si toca. Devuelve true si la ha tomado. */
  checkInterrupts(): boolean {
    if ((this.mip & this.mie) !== 0) this.waiting = false; // WFI despierta aunque MIE=0
    const irq = this.pendingInterrupt();
    if (irq < 0) return false;
    this.trap(irq, 0, true);
    return true;
  }

  // ---------------------------------------------------------------- CSR

  /** Lee un CSR. Lanza Trap si no existe o el modo actual no puede leerlo. */
  csrRead(csr: number, insn: number): number {
    if (((csr >>> 8) & 3) > this.priv) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
    switch (csr) {
      case 0x300: return this.mstatus;
      case 0x301: return MISA;
      case 0x304: return this.mie;
      case 0x305: return this.mtvec;
      case 0x306: return this.mcounteren;
      case 0x310: return 0; // mstatush
      case 0x320: return 0; // mcountinhibit
      case 0x340: return this.mscratch;
      case 0x341: return this.mepc;
      case 0x342: return this.mcause;
      case 0x343: return this.mtval;
      case 0x344: return this.mip;
      case 0x7a0: case 0x7a1: case 0x7a2: return 0; // tselect/tdata1/tdata2: sin disparadores
      case 0xf11: case 0xf12: case 0xf13: case 0xf14: case 0xf15: return 0;
      case 0xb00: case 0xc00: return this.counter(this.cycle, false, csr);
      case 0xb80: case 0xc80: return this.counter(this.cycle, true, csr);
      case 0xb02: case 0xc02: return this.counter(this.instret, false, csr);
      case 0xb82: case 0xc82: return this.counter(this.instret, true, csr);
      case 0xc01: return this.counter(this.readTime(), false, csr);
      case 0xc81: return this.counter(this.readTime(), true, csr);
    }
    if (csr >= 0x3a0 && csr <= 0x3a3) return this.pmpcfg[csr - 0x3a0];
    if (csr >= 0x3b0 && csr <= 0x3bf) return this.pmpaddr[csr - 0x3b0];
    // mhpmcounter3..31 (+h) y mhpmevent3..31: existen pero valen cero.
    if ((csr >= 0xb03 && csr <= 0xb1f) || (csr >= 0xb83 && csr <= 0xb9f) ||
        (csr >= 0x323 && csr <= 0x33f)) return 0;
    throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
  }

  private counter(value: number, high: boolean, csr: number): number {
    // En modo U, los contadores solo se ven si mcounteren lo permite.
    if (this.priv === PRIV_U && csr >= 0xc00 && !((this.mcounteren >>> (csr & 0x1f)) & 1)) {
      throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, 0);
    }
    return high ? Math.floor(value / 4294967296) | 0 : value | 0;
  }

  /** Escribe un CSR. Los de solo lectura (bits 11:10 = 11) dan instrucción ilegal. */
  csrWrite(csr: number, v: number, insn: number): void {
    if ((csr >>> 10) === 3 || ((csr >>> 8) & 3) > this.priv) {
      throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
    }
    switch (csr) {
      case 0x300: {
        let s = (this.mstatus & ~MSTATUS_MASK) | (v & MSTATUS_MASK);
        // MPP es WARL: solo M (3) y U (0) existen.
        if (((s >>> 11) & 3) !== PRIV_M) s &= ~MSTATUS_MPP;
        this.mstatus = s;
        return;
      }
      case 0x301: return; // misa: no se puede cambiar
      case 0x304: this.mie = v & ((1 << IRQ.MSI) | (1 << IRQ.MTI) | (1 << IRQ.MEI)); return;
      case 0x305: this.mtvec = v & ~2; return;
      case 0x306: this.mcounteren = v & 7; return;
      case 0x310: case 0x320: return;
      case 0x340: this.mscratch = v; return;
      case 0x341: this.mepc = v & ~3; return;
      case 0x342: this.mcause = v; return;
      case 0x343: this.mtval = v; return;
      case 0x344: this.mip = (this.mip & ~(1 << IRQ.MSI)) | (v & (1 << IRQ.MSI)); return;
      case 0x7a0: case 0x7a1: case 0x7a2: return;
      // Escribir un contador: el valor escrito es el que lee la instrucción siguiente,
      // así que restamos 1 para compensar el incremento de esta misma instrucción.
      case 0xb00: this.cycle = this.setLow(this.cycle, v) - 1; return;
      case 0xb80: this.cycle = this.setHigh(this.cycle, v) - 1; return;
      case 0xb02: this.instret = this.setLow(this.instret, v) - 1; return;
      case 0xb82: this.instret = this.setHigh(this.instret, v) - 1; return;
    }
    if (csr >= 0x3a0 && csr <= 0x3a3) { this.pmpcfg[csr - 0x3a0] = v; return; }
    if (csr >= 0x3b0 && csr <= 0x3bf) { this.pmpaddr[csr - 0x3b0] = v; return; }
    if ((csr >= 0xb03 && csr <= 0xb1f) || (csr >= 0xb83 && csr <= 0xb9f) ||
        (csr >= 0x323 && csr <= 0x33f)) return;
    throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
  }

  private setLow(c: number, v: number): number {
    return Math.floor(c / 4294967296) * 4294967296 + (v >>> 0);
  }
  private setHigh(c: number, v: number): number {
    return (v >>> 0) * 4294967296 + (c % 4294967296);
  }

  // ---------------------------------------------------------------- el bucle

  /**
   * Ejecuta hasta `budget` instrucciones. Devuelve cuántas se retiraron.
   * Sale antes si la CPU queda esperando (WFI) o si una escritura de CSR
   * pudo desbloquear una interrupción (la máquina vuelve a mirarlas).
   */
  run(budget: number): number {
    let done = 0;
    while (done < budget) {
      if (this.waiting) break;
      try {
        done += this.runInner(budget - done);
        if (this.breakOut) { this.breakOut = false; break; }
      } catch (e) {
        if (!(e instanceof Trap)) throw e;
        // Una instrucción que provoca una excepción no se retira, pero cuenta como ciclo.
        this.cycle++;
        done++;
        this.trap(e.cause, e.tval, false);
      }
    }
    return done;
  }

  /** Lo activan CSR, MRET y WFI para devolver el control a la máquina. */
  private breakOut = false;

  private runInner(budget: number): number {
    const x = this.x;
    const ram = this.bus.view;
    const ramBase = this.bus.ramBase;
    const ramLimit = this.bus.ramSize - 4;
    let n = 0;
    for (; n < budget; n++) {
      const pc = this.pc;
      // Fetch: sin extensión C, el pc siempre está alineado a 4 (lo garantizan los saltos).
      const foff = (pc - ramBase) >>> 0;
      if (foff > ramLimit) throw new Trap(CAUSE.FETCH_ACCESS, pc);
      const insn = ram.getInt32(foff, true);

      const rd = (insn >>> 7) & 31;
      const rs1 = (insn >>> 15) & 31;
      const rs2 = (insn >>> 20) & 31;
      const funct3 = (insn >>> 12) & 7;
      let next = (pc + 4) | 0;

      switch (insn & 0x7f) {
        case 0x37: // LUI
          if (rd) x[rd] = insn & 0xfffff000;
          break;
        case 0x17: // AUIPC
          if (rd) x[rd] = (pc + (insn & 0xfffff000)) | 0;
          break;
        case 0x6f: { // JAL
          const imm = ((insn >> 31) << 20) | (((insn >>> 12) & 0xff) << 12) |
            (((insn >>> 20) & 1) << 11) | (((insn >>> 21) & 0x3ff) << 1);
          const target = (pc + imm) | 0;
          if (target & 3) throw new Trap(CAUSE.MISALIGNED_FETCH, target);
          if (rd) x[rd] = next;
          next = target;
          break;
        }
        case 0x67: { // JALR
          if (funct3 !== 0) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
          const target = ((x[rs1] + (insn >> 20)) & ~1) | 0;
          if (target & 3) throw new Trap(CAUSE.MISALIGNED_FETCH, target);
          if (rd) x[rd] = next;
          next = target;
          break;
        }
        case 0x63: { // BRANCH
          const a = x[rs1], b = x[rs2];
          let taken: boolean;
          switch (funct3) {
            case 0: taken = a === b; break;
            case 1: taken = a !== b; break;
            case 4: taken = a < b; break;
            case 5: taken = a >= b; break;
            case 6: taken = (a >>> 0) < (b >>> 0); break;
            case 7: taken = (a >>> 0) >= (b >>> 0); break;
            default: throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
          }
          if (taken) {
            const imm = ((insn >> 31) << 12) | (((insn >>> 7) & 1) << 11) |
              (((insn >>> 25) & 0x3f) << 5) | (((insn >>> 8) & 0xf) << 1);
            const target = (pc + imm) | 0;
            if (target & 3) throw new Trap(CAUSE.MISALIGNED_FETCH, target);
            next = target;
          }
          break;
        }
        case 0x03: { // LOAD
          const addr = (x[rs1] + (insn >> 20)) | 0;
          let v: number;
          const off = (addr - ramBase) >>> 0;
          switch (funct3) {
            case 0: v = off < this.bus.ramSize ? ram.getInt8(off) : (this.load8(addr) << 24) >> 24; break;
            case 1: v = (this.load16(addr) << 16) >> 16; break;
            case 2: v = off <= ramLimit ? ram.getInt32(off, true) : this.load32(addr); break;
            case 4: v = this.load8(addr); break;
            case 5: v = this.load16(addr); break;
            default: throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
          }
          if (rd) x[rd] = v;
          break;
        }
        case 0x23: { // STORE
          const imm = ((insn >> 25) << 5) | ((insn >>> 7) & 31);
          const addr = (x[rs1] + imm) | 0;
          const v = x[rs2];
          switch (funct3) {
            case 0: this.store8(addr, v); break;
            case 1: this.store16(addr, v); break;
            case 2: {
              const off = (addr - ramBase) >>> 0;
              if (off <= ramLimit) ram.setInt32(off, v, true); else this.store32(addr, v);
              break;
            }
            default: throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
          }
          // Cualquier escritura a la palabra reservada rompe la reserva de LR.
          if (this.reservation === (addr & ~3)) this.reservation = -1;
          break;
        }
        case 0x13: { // OP-IMM
          const imm = insn >> 20;
          const a = x[rs1];
          let v: number;
          switch (funct3) {
            case 0: v = (a + imm) | 0; break;
            case 1:
              if ((insn >>> 25) !== 0) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
              v = a << rs2; break;
            case 2: v = a < imm ? 1 : 0; break;
            case 3: v = (a >>> 0) < (imm >>> 0) ? 1 : 0; break;
            case 4: v = a ^ imm; break;
            case 5: {
              const f7 = insn >>> 25;
              if (f7 === 0) v = a >>> rs2 | 0;
              else if (f7 === 0x20) v = a >> rs2;
              else throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
              break;
            }
            case 6: v = a | imm; break;
            default: v = a & imm; break;
          }
          if (rd) x[rd] = v;
          break;
        }
        case 0x33: { // OP (incluye la extensión M)
          const a = x[rs1], b = x[rs2];
          const f7 = insn >>> 25;
          let v: number;
          if (f7 === 0) {
            switch (funct3) {
              case 0: v = (a + b) | 0; break;
              case 1: v = a << (b & 31); break;
              case 2: v = a < b ? 1 : 0; break;
              case 3: v = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
              case 4: v = a ^ b; break;
              case 5: v = (a >>> (b & 31)) | 0; break;
              case 6: v = a | b; break;
              default: v = a & b; break;
            }
          } else if (f7 === 0x20 && funct3 === 0) {
            v = (a - b) | 0;
          } else if (f7 === 0x20 && funct3 === 5) {
            v = a >> (b & 31);
          } else if (f7 === 1) {
            switch (funct3) {
              case 0: v = Math.imul(a, b); break;
              case 1: v = mulh(a, b); break;
              case 2: v = mulhsu(a, b); break;
              case 3: v = mulhu(a, b); break;
              case 4: // DIV: /0 da -1; -2^31 / -1 desborda y da -2^31
                v = b === 0 ? -1 : (a === -0x80000000 && b === -1) ? a : (a / b) | 0; break;
              case 5: // DIVU
                v = b === 0 ? -1 : ((a >>> 0) / (b >>> 0)) | 0; break;
              case 6: // REM
                v = b === 0 ? a : (a === -0x80000000 && b === -1) ? 0 : (a % b) | 0; break;
              default: // REMU
                v = b === 0 ? a : ((a >>> 0) % (b >>> 0)) | 0; break;
            }
          } else {
            throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
          }
          if (rd) x[rd] = v;
          break;
        }
        case 0x0f: // MISC-MEM: FENCE y FENCE.I no hacen nada con un solo hart sin cachés
          if (funct3 > 1) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
          break;
        case 0x73: // SYSTEM
          next = this.system(insn, pc, next, rd, rs1, funct3);
          if (this.breakOut) { this.pc = next; this.instret++; this.cycle++; return n + 1; }
          break;
        case 0x2f: // AMO (extensión A)
          this.atomic(insn, rd, rs1, rs2, funct3);
          break;
        default:
          throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
      }
      this.pc = next;
      this.instret++;
      this.cycle++;
    }
    return n;
  }

  /** Instrucciones SYSTEM: ECALL, EBREAK, MRET, WFI y las seis de CSR. Devuelve el siguiente pc. */
  private system(insn: number, pc: number, next: number, rd: number, rs1: number, funct3: number): number {
    if (funct3 === 0) {
      if (rd !== 0 || rs1 !== 0) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
      switch (insn >>> 20) {
        case 0x000: // ECALL
          throw new Trap(this.priv === PRIV_M ? CAUSE.ECALL_M : CAUSE.ECALL_U, 0);
        case 0x001: // EBREAK
          throw new Trap(CAUSE.BREAKPOINT, pc);
        case 0x302: { // MRET
          if (this.priv !== PRIV_M) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
          const s = this.mstatus;
          const mpp = (s >>> 11) & 3;
          this.priv = mpp;
          let ns = (s & ~(MSTATUS_MIE | MSTATUS_MPP)) | MSTATUS_MPIE;
          if (s & MSTATUS_MPIE) ns |= MSTATUS_MIE;
          if (mpp !== PRIV_M) ns &= ~MSTATUS_MPRV;
          this.mstatus = ns;
          this.breakOut = true;
          return this.mepc;
        }
        case 0x105: // WFI
          if (this.priv === PRIV_U && (this.mstatus & MSTATUS_TW)) {
            throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
          }
          this.waiting = true;
          this.breakOut = true;
          return next;
      }
      throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
    }
    if (funct3 === 4) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);

    // Zicsr. funct3 & 3: 1=RW, 2=RS, 3=RC; funct3 & 4: el operando es inmediato (uimm = rs1).
    const csr = insn >>> 20;
    const op = funct3 & 3;
    const src = (funct3 & 4) ? rs1 : this.x[rs1];
    // CSRRW con rd=x0 no lee; CSRRS/CSRRC con rs1=x0 (o uimm=0) no escriben.
    const writes = op === 1 || rs1 !== 0;
    let old = 0;
    if (op !== 1 || rd !== 0) old = this.csrRead(csr, insn);
    if (writes) {
      const v = op === 1 ? src : op === 2 ? (old | src) : (old & ~src);
      this.csrWrite(csr, v, insn);
      this.breakOut = true; // puede haber habilitado una interrupción
    } else if (csr >>> 10 !== 3 && ((csr >>> 8) & 3) > this.priv) {
      throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
    }
    if (rd) this.x[rd] = old;
    return next;
  }

  /** Extensión A: LR/SC y las AMO. Con un solo hart, "atómico" es simplemente leer-modificar-escribir. */
  private atomic(insn: number, rd: number, rs1: number, rs2: number, funct3: number): void {
    if (funct3 !== 2) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
    const addr = this.x[rs1];
    const f5 = insn >>> 27;
    // Las atómicas exigen alineación natural (aquí sí se lanza la excepción).
    if (addr & 3) {
      throw new Trap(f5 === 2 ? CAUSE.MISALIGNED_LOAD : CAUSE.MISALIGNED_STORE, addr);
    }
    if (f5 === 2) { // LR.W
      if (rs2 !== 0) throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
      const v = this.load32(addr);
      this.reservation = addr;
      if (rd) this.x[rd] = v;
      return;
    }
    if (f5 === 3) { // SC.W: escribe solo si la reserva sigue viva. rd = 0 si tuvo éxito.
      const ok = this.reservation === addr;
      if (ok) this.store32(addr, this.x[rs2]);
      this.reservation = -1;
      if (rd) this.x[rd] = ok ? 0 : 1;
      return;
    }
    let old: number;
    try {
      old = this.load32(addr);
    } catch (e) {
      // Una AMO que falla al leer se notifica como fallo de escritura (spec A, §AMO).
      if (e instanceof Trap && e.cause === CAUSE.LOAD_ACCESS) throw new Trap(CAUSE.STORE_ACCESS, addr);
      throw e;
    }
    const b = this.x[rs2];
    let v: number;
    switch (f5) {
      case 0x01: v = b; break; // AMOSWAP
      case 0x00: v = (old + b) | 0; break; // AMOADD
      case 0x04: v = old ^ b; break; // AMOXOR
      case 0x0c: v = old & b; break; // AMOAND
      case 0x08: v = old | b; break; // AMOOR
      case 0x10: v = old < b ? old : b; break; // AMOMIN
      case 0x14: v = old > b ? old : b; break; // AMOMAX
      case 0x18: v = (old >>> 0) < (b >>> 0) ? old : b; break; // AMOMINU
      case 0x1c: v = (old >>> 0) > (b >>> 0) ? old : b; break; // AMOMAXU
      default: throw new Trap(CAUSE.ILLEGAL_INSTRUCTION, insn);
    }
    this.store32(addr, v);
    if (this.reservation === addr) this.reservation = -1;
    if (rd) this.x[rd] = old;
  }
}
