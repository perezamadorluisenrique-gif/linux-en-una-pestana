// Cargador mínimo de ELF32 little-endian: segmentos PT_LOAD y tabla de símbolos.
// Basta para los riscv-tests y para programas bare-metal propios.

export interface ElfImage {
  entry: number;
  segments: { addr: number; data: Uint8Array; memsz: number }[];
  symbols: Map<string, number>;
}

export function parseElf(buf: Uint8Array): ElfImage {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, false) !== 0x7f454c46) throw new Error("no es un ELF");
  if (buf[4] !== 1 || buf[5] !== 1) throw new Error("solo ELF32 little-endian");
  if (dv.getUint16(18, true) !== 243) throw new Error("no es RISC-V");
  const entry = dv.getUint32(24, true);
  const phoff = dv.getUint32(28, true), shoff = dv.getUint32(32, true);
  const phentsize = dv.getUint16(42, true), phnum = dv.getUint16(44, true);
  const shentsize = dv.getUint16(46, true), shnum = dv.getUint16(48, true);

  const segments: ElfImage["segments"] = [];
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phentsize;
    if (dv.getUint32(p, true) !== 1) continue; // PT_LOAD
    const off = dv.getUint32(p + 4, true), paddr = dv.getUint32(p + 12, true);
    const filesz = dv.getUint32(p + 16, true), memsz = dv.getUint32(p + 20, true);
    segments.push({ addr: paddr, data: buf.subarray(off, off + filesz), memsz });
  }

  const symbols = new Map<string, number>();
  for (let i = 0; i < shnum; i++) {
    const s = shoff + i * shentsize;
    if (dv.getUint32(s + 4, true) !== 2) continue; // SHT_SYMTAB
    const off = dv.getUint32(s + 16, true), size = dv.getUint32(s + 20, true);
    const strtab = shoff + dv.getUint32(s + 24, true) * shentsize;
    const stroff = dv.getUint32(strtab + 16, true);
    for (let e = off; e < off + size; e += 16) {
      let n = stroff + dv.getUint32(e, true), name = "";
      while (buf[n]) name += String.fromCharCode(buf[n++]);
      if (name) symbols.set(name, dv.getUint32(e + 4, true));
    }
  }
  return { entry, segments, symbols };
}
