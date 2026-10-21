// La máquina completa: CPU + RAM + UART + CLINT + syscon, y el device tree que la describe.
// El mapa de memoria es el que espera la imagen de Linux nommu de mini-rv32ima. Capítulos 6 y 7.

import { Bus } from "./bus.ts";
import { CPU, IRQ } from "./cpu.ts";
import { Clint, Syscon, Uart16550 } from "./devices.ts";
import { buildDtb } from "./dtb.ts";

export const RAM_BASE = 0x80000000;
export const UART_BASE = 0x10000000;
export const CLINT_BASE = 0x11000000;
export const SYSCON_BASE = 0x11100000;
/** Frecuencia de mtime: 1 MHz, un tick por microsegundo. */
export const TIMEBASE = 1_000_000;

export interface MachineOptions {
  ramSize?: number;
  bootargs?: string;
  /** Reloj en microsegundos. Por defecto, el reloj de pared desde que arranca la máquina. */
  clock?: () => number;
}

export type Power = "running" | "poweroff" | "reboot";

export class Machine {
  readonly bus: Bus;
  readonly cpu: CPU;
  readonly uart: Uart16550;
  readonly clint: Clint;
  readonly syscon: Syscon;
  readonly dtb: Uint8Array;
  readonly dtbAddr: number;
  power: Power = "running";
  private readonly clock: () => number;

  constructor(opts: MachineOptions = {}) {
    const ramSize = opts.ramSize ?? 64 * 1024 * 1024;
    this.bus = new Bus(RAM_BASE, ramSize);
    this.cpu = new CPU(this.bus);
    this.uart = new Uart16550(UART_BASE);
    this.clint = new Clint(CLINT_BASE);
    this.syscon = new Syscon(SYSCON_BASE);
    for (const d of [this.uart, this.clint, this.syscon]) this.bus.attach(d);
    this.syscon.onPower = (p) => { this.power = p; };

    const t0 = performance.now();
    this.clock = opts.clock ?? (() => Math.floor((performance.now() - t0) * 1000));
    this.clint.now = this.clock;
    this.cpu.readTime = this.clock;

    // El device tree va al final de la RAM; la memoria que anunciamos a Linux termina antes.
    const reserve = 16 * 1024;
    this.dtb = buildDtb(this.describe(ramSize - reserve, opts.bootargs ??
      `earlycon=uart8250,mmio,0x${UART_BASE.toString(16)},1000000 console=ttyS0`));
    if (this.dtb.length > reserve) throw new Error("device tree demasiado grande");
    this.dtbAddr = RAM_BASE + ramSize - reserve;
    this.bus.load(this.dtbAddr, this.dtb);
  }

  /** El árbol de dispositivos de esta máquina, escrito a mano (no copiado de ningún .dts). */
  private describe(memSize: number, bootargs: string) {
    const reg64 = (base: number, size: number) => [0, base, 0, size];
    return {
      props: {
        "#address-cells": 2, "#size-cells": 2,
        compatible: "pestana,rv32-nommu", model: "Linux en una pestana (RV32IMA)",
      },
      children: {
        chosen: { props: { bootargs } },
        [`memory@${RAM_BASE.toString(16)}`]: {
          props: { device_type: "memory", reg: reg64(RAM_BASE, memSize) },
        },
        cpus: {
          props: { "#address-cells": 1, "#size-cells": 0, "timebase-frequency": TIMEBASE },
          children: {
            "cpu@0": {
              props: {
                device_type: "cpu", reg: 0, status: "okay", compatible: "riscv",
                "riscv,isa": "rv32ima", "mmu-type": "riscv,none", phandle: 1,
              },
              children: {
                "interrupt-controller": {
                  props: {
                    "#interrupt-cells": 1, "interrupt-controller": true,
                    compatible: "riscv,cpu-intc", phandle: 2,
                  },
                },
              },
            },
          },
        },
        soc: {
          props: { "#address-cells": 2, "#size-cells": 2, compatible: "simple-bus", ranges: true },
          children: {
            [`serial@${UART_BASE.toString(16)}`]: {
              props: { compatible: "ns16550a", reg: reg64(UART_BASE, 0x100), "clock-frequency": 0x1000000 },
            },
            [`clint@${CLINT_BASE.toString(16)}`]: {
              props: {
                compatible: ["sifive,clint0", "riscv,clint0"], reg: reg64(CLINT_BASE, 0x10000),
                // <&intc 3> = software de máquina, <&intc 7> = temporizador de máquina
                "interrupts-extended": [2, IRQ.MSI, 2, IRQ.MTI],
              },
            },
            [`syscon@${SYSCON_BASE.toString(16)}`]: {
              props: { compatible: "syscon", reg: reg64(SYSCON_BASE, 0x1000), phandle: 4 },
            },
            poweroff: { props: { compatible: "syscon-poweroff", regmap: 4, offset: 0, value: 0x5555 } },
            reboot: { props: { compatible: "syscon-reboot", regmap: 4, offset: 0, value: 0x7777 } },
          },
        },
      },
    };
  }

  /** Carga un kernel en el inicio de la RAM y deja la CPU lista para saltar a él. */
  loadKernel(image: Uint8Array): void {
    this.bus.load(RAM_BASE, image);
    this.cpu.reset(RAM_BASE);
    // Convención de arranque de RISC-V Linux: a0 = id del hart, a1 = dirección del DTB.
    this.cpu.x[10] = 0;
    this.cpu.x[11] = this.dtbAddr;
  }

  /** Actualiza las líneas de interrupción del CLINT en mip. */
  private updateInterrupts(): void {
    const cpu = this.cpu;
    let mip = cpu.mip & ~((1 << IRQ.MTI) | (1 << IRQ.MSI));
    if (this.clock() >= this.clint.mtimecmp) mip |= 1 << IRQ.MTI;
    if (this.clint.msip) mip |= 1 << IRQ.MSI;
    cpu.mip = mip;
  }

  /**
   * Ejecuta hasta `budget` instrucciones en tramos cortos, atendiendo interrupciones entre tramos.
   * Devuelve 0 si puede seguir, o los microsegundos que la CPU va a estar dormida (WFI).
   */
  step(budget: number, slice = 2048): number {
    const cpu = this.cpu;
    let done = 0;
    while (done < budget && this.power === "running") {
      this.updateInterrupts();
      cpu.checkInterrupts();
      if (cpu.waiting) {
        const wait = this.clint.mtimecmp - this.clock();
        if (wait > 0) return Math.min(wait, 1_000_000);
        cpu.waiting = false; // WFI puede terminar en cualquier momento: seguimos
        continue;
      }
      done += cpu.run(Math.min(slice, budget - done));
    }
    return 0;
  }
}
