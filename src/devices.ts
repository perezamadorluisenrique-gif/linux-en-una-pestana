// Dispositivos de la máquina: UART 16550, CLINT (temporizador) y syscon (apagar/reiniciar).
// Cada uno es un puñado de registros en una dirección fija. Capítulo 6 del curso.

import type { Device } from "./bus.ts";

/**
 * UART compatible con el 16550A, lo justo para el driver 8250 de Linux en modo
 * sondeo (sin interrupción): transmisor siempre libre, receptor con cola.
 */
export class Uart16550 implements Device {
  readonly name = "uart";
  readonly base: number;
  readonly size = 0x100;
  /** Se llama con cada byte que el programa escribe en el transmisor. */
  onTransmit: (byte: number) => void = () => {};
  private rx: number[] = [];
  private ier = 0;
  private lcr = 0;
  private mcr = 0;
  private scr = 0;
  private fcr = 0;
  private dll = 0;
  private dlm = 0;
  private threPending = false;

  constructor(base: number) {
    this.base = base;
  }

  /** Mete bytes en la cola de recepción (lo que el usuario teclea). */
  receive(bytes: Iterable<number>): void {
    for (const b of bytes) this.rx.push(b & 0xff);
  }
  get rxPending(): number {
    return this.rx.length;
  }
  /** ¿Pediría interrupción esta UART? (para quien la conecte a un controlador; con sondeo no hace falta) */
  get irq(): boolean {
    return ((this.ier & 1) !== 0 && this.rx.length > 0) || ((this.ier & 2) !== 0 && this.threPending);
  }

  read(offset: number): number {
    const dlab = (this.lcr & 0x80) !== 0;
    switch (offset) {
      case 0: // RBR (o DLL con DLAB=1)
        if (dlab) return this.dll;
        return this.rx.length ? this.rx.shift()! : 0;
      case 1: return dlab ? this.dlm : this.ier;
      case 2: { // IIR: qué interrupción hay pendiente; bits 7:6 = 11 si la FIFO está activa
        const fifo = (this.fcr & 1) ? 0xc0 : 0;
        if ((this.ier & 1) && this.rx.length) return fifo | 0x04; // dato recibido
        if ((this.ier & 2) && this.threPending) {
          this.threPending = false; // leer IIR "consume" la interrupción de THR vacío
          return fifo | 0x02;
        }
        return fifo | 0x01; // ninguna
      }
      case 3: return this.lcr;
      case 4: return this.mcr;
      case 5: // LSR: THRE y TEMT siempre (transmitimos al instante); DR si hay datos
        return 0x60 | (this.rx.length ? 0x01 : 0);
      case 6: // MSR: CTS, DSR y DCD activos; en modo loopback refleja MCR
        return (this.mcr & 0x10) ? ((this.mcr & 0x0f) << 4) : 0xb0;
      case 7: return this.scr;
    }
    return 0;
  }

  write(offset: number, value: number): void {
    value &= 0xff;
    const dlab = (this.lcr & 0x80) !== 0;
    switch (offset) {
      case 0:
        if (dlab) this.dll = value;
        else { this.onTransmit(value); this.threPending = true; }
        return;
      case 1:
        if (dlab) { this.dlm = value; return; }
        // Habilitar la interrupción de THR vacío la dispara en seguida: el transmisor ya está libre.
        if ((value & 2) && !(this.ier & 2)) this.threPending = true;
        this.ier = value & 0x0f;
        return;
      case 2: this.fcr = value & 0xc9; if (value & 2) this.rx.length = 0; return;
      case 3: this.lcr = value; return;
      case 4: this.mcr = value & 0x1f; return;
      case 7: this.scr = value; return;
    }
  }
}

/**
 * CLINT (Core Local Interruptor) de SiFive: mtime, mtimecmp y msip.
 * mtime cuenta a `freq` Hz; cuando mtime >= mtimecmp, se activa la interrupción de temporizador.
 */
export class Clint implements Device {
  readonly name = "clint";
  readonly base: number;
  readonly size = 0x10000;
  msip = 0;
  mtimecmp = Number.MAX_SAFE_INTEGER;
  /** Devuelve el valor actual de mtime (en ticks). Lo fija la máquina. */
  now: () => number = () => 0;

  constructor(base: number) {
    this.base = base;
  }

  read(offset: number): number {
    switch (offset) {
      case 0x0000: return this.msip;
      case 0x4000: return this.mtimecmp % 4294967296;
      case 0x4004: return Math.floor(this.mtimecmp / 4294967296);
      case 0xbff8: return this.now() % 4294967296;
      case 0xbffc: return Math.floor(this.now() / 4294967296);
    }
    return 0;
  }

  write(offset: number, value: number): void {
    value >>>= 0;
    switch (offset) {
      case 0x0000: this.msip = value & 1; return;
      // mtimecmp es de 64 bits y se escribe en dos mitades de 32.
      case 0x4000: this.mtimecmp = Math.floor(this.mtimecmp / 4294967296) * 4294967296 + value; return;
      case 0x4004: this.mtimecmp = value * 4294967296 + (this.mtimecmp % 4294967296); return;
    }
  }
}

/** Registro syscon: escribir 0x5555 apaga la máquina y 0x7777 la reinicia. */
export class Syscon implements Device {
  readonly name = "syscon";
  readonly base: number;
  readonly size = 0x1000;
  onPower: (what: "poweroff" | "reboot") => void = () => {};
  constructor(base: number) {
    this.base = base;
  }
  read(): number {
    return 0;
  }
  write(offset: number, value: number): void {
    if (offset !== 0) return;
    if ((value & 0xffff) === 0x5555) this.onPower("poweroff");
    else if ((value & 0xffff) === 0x7777) this.onPower("reboot");
  }
}
