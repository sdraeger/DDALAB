// Version 1.0 `.npy` files of C-order little-endian f64 values, the arrays of a result bundle (dda-rs `npy_header`).

const MAGIC = [0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59]; // \x93NUMPY

export interface Npy {
  /** The bytes before the values. */
  headerBytes: number;
  shape: number[];
}

/** The header of `file`; throws, naming `path`, unless it is a v1.0 `.npy` of 64-bit floats in C order. */
export async function readNpyHeader(file: Blob, path: string): Promise<Npy> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  const length = head[8] | (head[9] << 8);
  const dict = await file.slice(10, 10 + length).text();
  const shape = /'shape': \(([\d, ]*)\)/
    .exec(dict)?.[1]
    .split(",")
    .filter((d) => d.trim())
    .map(Number);
  const ok =
    MAGIC.every((b, i) => head[i] === b) &&
    head[6] === 1 &&
    dict.includes("'descr': '<f8'") &&
    dict.includes("'fortran_order': False");
  if (!ok || !shape) throw new Error(`${path} is not a .npy file of 64-bit floats`);
  return { headerBytes: 10 + length, shape };
}

/** The header dda-rs `npy_header` writes for `shape`: the dict padded with spaces to a multiple of 64 bytes. */
export function npyHeader(shape: number[]): Uint8Array<ArrayBuffer> {
  const dims = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(", ")})`;
  const dict = `{'descr': '<f8', 'fortran_order': False, 'shape': ${dims}, }`;
  const padded = `${dict}${" ".repeat((64 - ((10 + dict.length + 1) % 64)) % 64)}\n`;
  const text = new TextEncoder().encode(padded);
  return Uint8Array.from([...MAGIC, 1, 0, text.length & 255, text.length >> 8, ...text]);
}

/** Values in an array of `shape`. */
export const count = (shape: number[]) => shape.reduce((n, d) => n * d, 1);
