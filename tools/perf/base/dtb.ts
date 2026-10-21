// Generador de device tree binario (FDT/DTB, especificación Devicetree v0.4, cap. 5).
// Linux no "descubre" el hardware: lee esta descripción, que le pasamos en el registro a1.

export type PropValue = string | string[] | number | number[] | Uint8Array | true;
export interface DtNode {
  props?: Record<string, PropValue>;
  children?: Record<string, DtNode>;
}

const FDT_BEGIN_NODE = 1, FDT_END_NODE = 2, FDT_PROP = 3, FDT_END = 9;

/** Codifica un valor de propiedad: cadenas terminadas en NUL, números como celdas de 32 bits big-endian. */
function encodeValue(v: PropValue): Uint8Array {
  if (v === true) return new Uint8Array(0); // propiedad vacía (p. ej. "interrupt-controller")
  if (v instanceof Uint8Array) return v;
  if (typeof v === "string") v = [v];
  if (typeof v === "number") v = [v];
  if (typeof v[0] === "string") {
    const bytes = new TextEncoder().encode((v as string[]).join("\0") + "\0");
    return bytes;
  }
  const cells = v as number[];
  const out = new Uint8Array(cells.length * 4);
  const dv = new DataView(out.buffer);
  cells.forEach((c, i) => dv.setUint32(i * 4, c >>> 0, false));
  return out;
}

export function buildDtb(root: DtNode, bootCpu = 0): Uint8Array {
  const struct: number[] = [];
  const strings: number[] = [];
  const stringOffsets = new Map<string, number>();

  const u32 = (v: number) => struct.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  const bytes = (b: Uint8Array) => {
    for (const x of b) struct.push(x);
    while (struct.length % 4) struct.push(0);
  };
  const nameOffset = (name: string) => {
    let off = stringOffsets.get(name);
    if (off === undefined) {
      off = strings.length;
      for (const b of new TextEncoder().encode(name)) strings.push(b);
      strings.push(0);
      stringOffsets.set(name, off);
    }
    return off;
  };

  const emit = (name: string, node: DtNode) => {
    u32(FDT_BEGIN_NODE);
    bytes(new TextEncoder().encode(name + "\0"));
    for (const [k, v] of Object.entries(node.props ?? {})) {
      const val = encodeValue(v);
      u32(FDT_PROP);
      u32(val.length);
      u32(nameOffset(k));
      bytes(val);
    }
    for (const [k, child] of Object.entries(node.children ?? {})) emit(k, child);
    u32(FDT_END_NODE);
  };
  emit("", root);
  u32(FDT_END);

  const HEADER = 40, RSVMAP = 16; // una entrada vacía (dirección 0, tamaño 0) cierra el mapa de reservas
  const offRsv = HEADER, offStruct = offRsv + RSVMAP, offStrings = offStruct + struct.length;
  const total = offStrings + strings.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  const header = [0xd00dfeed, total, offStruct, offStrings, offRsv, 17, 16, bootCpu, strings.length, struct.length];
  header.forEach((v, i) => dv.setUint32(i * 4, v, false));
  out.set(struct, offStruct);
  out.set(strings, offStrings);
  return out;
}
