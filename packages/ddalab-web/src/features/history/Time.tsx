// When a history record was made, as its row shows it: the time of day for one of today, else the date.

/** The time of day for a result of today, else the date. */
function when(time: number) {
  const date = new Date(time);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    : date.toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** A record whose time no Date holds (one from elsewhere) reads as unknown, and the rest of the history still shows. */
export function Time({ at }: { at: number }) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return <span>unknown time</span>;
  return <time dateTime={date.toISOString()}>{when(at)}</time>;
}
