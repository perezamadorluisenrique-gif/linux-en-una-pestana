// El bus: une la RAM y los dispositivos en un único espacio de direcciones de 32 bits.
//
// La CPU no sabe qué hay detrás de cada dirección: pide "léeme 4 bytes en 0x10000005"
// y el bus decide si eso es RAM o un registro de la UART. Así funciona el hardware real
// (E/S mapeada en memoria) y así lo explica el capítulo 4 del curso.

/** Un dispositivo mapeado en memoria. `offset` es relativo a su dirección base. */
export interface Device {
  readonly name: string;
  readonly base: number;
  readonly size: number;
  /** Lee `width` bytes (1, 2 o 4). Devuelve el valor sin signo. */
  read(offset: number, width: number): number;
  /** Escribe los `width` bytes de menor peso de `value`. */
  write(offset: number, value: number, width: number): void;
}

/** Fallo de acceso: la CPU lo convierte en una excepción "access fault". */
export class BusError extends Error {
  readonly addr: number;
  constructor(addr: number) {
    super(`bus error at 0x${(addr >>> 0).toString(16)}`);
    this.addr = addr >>> 0;
  }
}

export class Bus {
  readonly ramBase: number;
  readonly ramSize: number;
  readonly ram: Uint8Array;
  /** DataView sobre la RAM: lee y escribe enteros little-endian en cualquier alineación. */
  readonly view: DataView;
  readonly devices: Device[] = [];

  constructor(ramBase: number, ramSize: number) {
    this.ramBase = ramBase >>> 0;
    this.ramSize = ramSize;
    this.ram = new Uint8Array(ramSize);
    this.view = new DataView(this.ram.buffer);
  }

  attach(dev: Device): void {
    this.devices.push(dev);
  }

  /** Copia bytes a la RAM (para cargar el kernel, el device tree, un ELF...). */
  load(addr: number, data: Uint8Array): void {
    const off = ((addr >>> 0) - this.ramBase) >>> 0;
    if (off + data.length > this.ramSize) throw new BusError(addr);
    this.ram.set(data, off);
  }

  private device(addr: number): Device {
    addr >>>= 0;
    for (const d of this.devices) {
      if (addr >= d.base && addr < d.base + d.size) return d;
    }
    throw new BusError(addr);
  }

  // Ruta lenta para todo lo que no es RAM. La ruta rápida (RAM) está en la CPU,
  // que accede directamente a `view` para no pagar una llamada por acceso.
  readIO(addr: number, width: number): number {
    const d = this.device(addr);
    return d.read((addr >>> 0) - d.base, width) >>> 0;
  }

  writeIO(addr: number, value: number, width: number): void {
    const d = this.device(addr);
    d.write((addr >>> 0) - d.base, value, width);
  }
}
