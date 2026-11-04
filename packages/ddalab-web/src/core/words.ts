/** `n` with its noun, singular for exactly one: "1 channel", "1,284 windows". */
export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** `x` with at most `digits` decimals and thousands separators: "93,600.001", "300.03". */
export const decimal = (x: number, digits = 3) =>
  x.toLocaleString("en-US", { maximumFractionDigits: digits });
