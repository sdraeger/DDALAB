// Ephemeral bidirectional hover highlight between the waveform viewer and the DDA result heatmap.
// Kept outside React/Zustand render cycles so 120 fps pointer motion never triggers React reconciliation.

export interface ChannelHighlight {
  /** Shown channel names (e.g. ["Fp1"] or ["Fp1", "Fp2"] for a CT/CD pair). */
  labels: string[];
  source: "waveform" | "heatmap";
}

type Listener = (highlight: ChannelHighlight | null) => void;

let current: ChannelHighlight | null = null;
const listeners = new Set<Listener>();

function same(a: ChannelHighlight | null, b: ChannelHighlight | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.source !== b.source || a.labels.length !== b.labels.length) return false;
  return a.labels.every((label, i) => label === b.labels[i]);
}

export function getChannelHighlight(): ChannelHighlight | null {
  return current;
}

export function setChannelHighlight(next: ChannelHighlight | null): void {
  if (same(current, next)) return;
  current = next;
  for (const listener of listeners) listener(current);
}

export function subscribeChannelHighlight(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
