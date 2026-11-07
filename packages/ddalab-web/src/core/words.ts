/** `n` with its noun, singular for exactly one: "1 channel", "1,284 windows". */
export const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** `x` with at most `digits` decimals and thousands separators: "93,600.001", "300.03". */
export const decimal = (x: number, digits = 3) =>
  x.toLocaleString("en-US", { maximumFractionDigits: digits });

const UNITS = ["kilobyte", "megabyte", "gigabyte", "terabyte"].map(
  (unit) => new Intl.NumberFormat("en-US", { style: "unit", unit, maximumSignificantDigits: 3 }),
);

/** Bytes in decimal units from kB up, to three significant digits: "0 kB", "24 kB", "6.71 MB". */
export const bytes = (n: number) => {
  const power = Math.min(UNITS.length, Math.max(1, Math.floor(Math.log10(Math.max(n, 1)) / 3)));
  return UNITS[power - 1].format(n / 1000 ** power);
};

/** What `error` says: its message, or the thrown value as text. */
export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
