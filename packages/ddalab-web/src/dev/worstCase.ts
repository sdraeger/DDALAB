// Worst-case recordings for the dev-only data toggle (DataToggle.tsx): BrainVision files built in memory and opened
// through the same path as files a user drops, so every value reaches the UI through the real readers. BrainVision
// bounds neither labels nor marker text, which EDF caps at 16 and the record's annotation bytes.
import type { RecordingInput } from "../core/engine";

export type DataSet = "demo" | "worst" | "empty" | "one" | "huge";

interface Marker {
  at: number; // seconds
  text: string;
  length?: number; // seconds
}

interface Spec {
  name: string; // the .vhdr's file name
  labels: string[];
  intervalUs: number; // SamplingInterval
  durationS: number;
  markers: Marker[];
}

const escaped = (s: string) => s.replaceAll(",", "\\1");

/** The .vhdr, .vmrk and .eeg (INT_16, multiplexed, 0.1 µV a step) of `spec`. */
function brainvision({ name, labels, intervalUs, durationS, markers }: Spec): RecordingInput {
  const stem = name.replace(/\.vhdr$/, "");
  const rate = 1e6 / intervalUs;
  const n = Math.round(durationS * rate);
  const vhdr = [
    "Brain Vision Data Exchange Header File Version 1.0",
    "[Common Infos]",
    "Codepage=UTF-8",
    `DataFile=${stem}.eeg`,
    `MarkerFile=${stem}.vmrk`,
    "DataFormat=BINARY",
    "DataOrientation=MULTIPLEXED",
    `NumberOfChannels=${labels.length}`,
    `SamplingInterval=${intervalUs}`,
    "[Binary Infos]",
    "BinaryFormat=INT_16",
    "[Channel Infos]",
    ...labels.map((label, i) => `Ch${i + 1}=${escaped(label)},,0.1,µV`),
  ].join("\n");
  const vmrk = [
    "Brain Vision Data Exchange Marker File, Version 1.0",
    "[Common Infos]",
    "Codepage=UTF-8",
    `DataFile=${stem}.eeg`,
    "[Marker Infos]",
    ...markers.map(
      (m, i) =>
        `Mk${i + 1}=Comment,${escaped(m.text)},${Math.round(m.at * rate) + 1},${Math.max(1, Math.round((m.length ?? 0) * rate))},0`,
    ),
  ].join("\n");
  const c = labels.length;
  const x = new Int16Array(n * c);
  for (let j = 0; j < c; j++) {
    const f1 = 1 + ((j * 7) % 11);
    const f2 = 9 + ((j * 13) % 23);
    for (let t = 0; t < n; t++) {
      const s = t / rate;
      x[t * c + j] = 400 * Math.sin(2 * Math.PI * f1 * s + j) + 150 * Math.sin(2 * Math.PI * f2 * s);
    }
  }
  return {
    kind: "files",
    primary: name,
    files: [
      new File([vhdr], name),
      new File([vmrk], `${stem}.vmrk`),
      new File([x.buffer as ArrayBuffer], `${stem}.eeg`),
    ],
  };
}

const BIDS = "sub-HUP117_ses-presurgery_task-interictal_acq-seeg";

// The first rows are what is on screen: each carries a different failure. The rest are ordinary SEEG contacts.
const WORST_LABELS = [
  "Left Anterior Hippocampus 10",
  "1",
  "EEG Fp1-REF",
  "EKG – Brustwand",
  "C3,C4",
  "",
  "DC",
  "DC",
  "Thoracic Respiratory Effort",
  "Kanał 3 Wiśniewska",
  ...["LA", "LAH", "LPH", "RA", "RAH", "RPH"].flatMap((shaft) =>
    Array.from({ length: 9 }, (_, i) => `${shaft}${i + 1}`),
  ),
];

const LONG_NOTE =
  "Electrographic seizure onset: low-voltage fast activity in LAH1–LAH4, spreading to LAT within 8 s; patient pressed the event button";

const WORST_MARKERS: Marker[] = [
  { at: 0, text: "S  1" },
  { at: 0, text: "Recording start – Dr. Aleksandra Wiśniewska-Kowalczyk" },
  { at: 12.5, text: LONG_NOTE, length: 95 },
  { at: 12.5, text: "z" },
  { at: 47, text: "EMG artifact >50 µV <chewing>" },
  { at: 120, text: "Anfallsbeginn – Patientin drückt Knopf" },
  { at: 121, text: "bartholomew.fitzgerald@northwind-industries-holdings.example.com flagged this" },
  { at: 330, text: "Sleep stage N2", length: 30 },
  { at: 599.9, text: "End of usable data" },
];

const SPIKES: Marker[] = Array.from({ length: 2000 }, (_, i) => ({
  at: 0.3 * i + 0.05,
  text: i % 7 === 0 ? "S 12" : "S  1",
}));

/** The inputs each data set opens; demo is the synthetic EDF the e2e tests use, empty opens nothing. */
export function inputsOf(set: DataSet): RecordingInput[] {
  switch (set) {
    case "demo":
      return [
        { kind: "synthetic", spec: { channels: 8, rateHz: 256, durationS: 600, seed: 1, annotations: true } },
      ];
    case "empty":
      return [];
    case "worst":
      return [
        brainvision({
          name: `${BIDS}_run-01_ieeg.vhdr`,
          labels: WORST_LABELS,
          intervalUs: 3333, // 300.030003 Hz
          durationS: 600,
          markers: WORST_MARKERS,
        }),
        brainvision({
          name: `${BIDS}_run-02_ieeg.vhdr`,
          labels: ["Left Anterior Hippocampus 10", "Left Anterior Hippocampus 11"],
          intervalUs: 3906, // 256.016 Hz
          durationS: 26 * 3600, // an overnight recording
          markers: [{ at: 93_599, text: LONG_NOTE }],
        }),
      ];
    case "one":
      return [
        brainvision({
          name: "a.vhdr",
          labels: ["Cz"],
          intervalUs: 4000,
          durationS: 1,
          markers: [{ at: 0.5, text: "spike" }],
        }),
      ];
    case "huge":
      return [
        brainvision({
          name: `${BIDS}_run-03_ieeg.vhdr`,
          labels: Array.from(
            { length: 256 },
            (_, i) =>
              `${["LA", "LAH", "LPH", "RA", "RAH", "RPH", "LOF", "ROF"][i % 8]}${Math.floor(i / 8) + 1}`,
          ),
          intervalUs: 4000,
          durationS: 600,
          markers: SPIKES,
        }),
      ];
  }
}
