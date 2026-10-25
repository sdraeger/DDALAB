// Synthetic recordings for tests and benchmarks: reachable only in dev and e2e builds.
// The generator itself arrives with the scan (Plan 2, Task 3); Task 2 defines the spec the engine takes.
export interface SyntheticSpec {
  channels: number;
  rateHz: number;
  durationS: number;
  seed: number;
}
