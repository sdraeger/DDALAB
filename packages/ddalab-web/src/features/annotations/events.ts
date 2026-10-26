// The exports of a recording's annotations: a BIDS events.tsv (onset, duration and trial_type, tab-separated, in
// seconds) and a JSON array of the same records. A point annotation has duration 0, BIDS's impulse; n/a would mean
// the duration is unknown, and dda-rs reads both as 0.
import type { Listed } from "./model";

type Event = Pick<Listed, "onset_s" | "duration_s" | "label">;

/** Seconds to the microsecond. */
const seconds = (s: number) => Number(s.toFixed(6));
/** A label as one TSV cell: tabs and line breaks become spaces, and an empty label is BIDS's n/a. */
const cell = (label: string) => label.replace(/[\t\r\n]+/g, " ").trim() || "n/a";

export const records = (events: Event[]) =>
  events.map((a) => ({
    onset: seconds(a.onset_s),
    duration: seconds(a.duration_s),
    trial_type: cell(a.label),
  }));

export const eventsTsv = (events: Event[]) =>
  [
    "onset\tduration\ttrial_type",
    ...records(events).map((r) => `${r.onset}\t${r.duration}\t${r.trial_type}`),
    "",
  ].join("\n");

export const eventsJson = (events: Event[]) => `${JSON.stringify(records(events), null, 2)}\n`;
