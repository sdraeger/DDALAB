// A live stream from `ddalab stream --serve`: the WebSocket on this computer that sends a header, then the stream's
// samples (binary: f32, row-major over its channels) and its DDA results and classes (JSON) as they come.

/** What `ddalab stream` says of the stream when the connection opens. */
export interface LiveHeader {
  name: string;
  channels: string[];
  sample_rate_hz: number;
  /** The row labels of each variant's results. */
  variants: Record<string, string[]>;
  classes?: string[] | null;
}

export type LiveMessage =
  | ({ type: "header" } & LiveHeader)
  | { type: "dda"; t: number; variants: Record<string, number[]> }
  | { type: "class"; t: number; class: string; scores: number[] };

/** The address `ddalab stream --serve` printed, checked: a ws: URL on this computer that carries its token. */
export function liveAddress(text: string): string {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    throw new Error("Paste the address ddalab stream --serve printed, such as ws://127.0.0.1:8765/?token=…");
  }
  if (url.protocol !== "ws:")
    throw new Error("The address starts with ws:, as ddalab stream --serve prints it");
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("A live stream connects only to this computer (127.0.0.1 or localhost)");
  }
  if (!url.searchParams.get("token"))
    throw new Error("The address needs the token ddalab stream --serve printed");
  return url.href;
}

/** The newest `seconds` of samples per channel and the newest results per variant. */
export class LiveBuffer {
  readonly header: LiveHeader;
  private readonly capacity: number;
  private readonly channels: Float32Array[];
  private filled = 0;
  private readonly dda = new Map<string, { t: number; values: number[] }[]>();
  latestClass: { t: number; class: string; scores: number[] } | null = null;
  /** Samples received in all, for the stream's clock. */
  received = 0;

  private readonly maxResults: number;

  constructor(header: LiveHeader, seconds: number, maxResults = 240) {
    this.maxResults = maxResults;
    this.header = header;
    this.capacity = Math.max(1, Math.round(seconds * header.sample_rate_hz));
    this.channels = header.channels.map(() => new Float32Array(this.capacity));
  }

  /** Appends row-major samples, dropping the oldest beyond the capacity. */
  samples(rows: Float32Array) {
    const width = this.channels.length;
    const count = Math.floor(rows.length / width);
    const kept = Math.min(count, this.capacity);
    const shift = Math.max(0, this.filled + kept - this.capacity);
    for (let c = 0; c < width; c++) {
      const channel = this.channels[c];
      if (shift > 0) channel.copyWithin(0, shift, this.filled);
      for (let r = count - kept; r < count; r++)
        channel[this.filled - shift + r - (count - kept)] = rows[r * width + c];
    }
    this.filled = Math.min(this.capacity, this.filled + kept);
    this.received += count;
  }

  channel(index: number): Float32Array {
    return this.channels[index].subarray(0, this.filled);
  }

  result(message: Extract<LiveMessage, { type: "dda" }>) {
    for (const [variant, values] of Object.entries(message.variants)) {
      const list = this.dda.get(variant) ?? [];
      list.push({ t: message.t, values });
      if (list.length > this.maxResults) list.shift();
      this.dda.set(variant, list);
    }
  }

  results(variant: string) {
    return this.dda.get(variant) ?? [];
  }
}

/**
 * Connects to `address` and calls `onChange` with the buffer whenever something arrives, `onClose` with why it ended.
 * Returns the function that disconnects.
 */
export function connectLive(
  address: string,
  seconds: number,
  onChange: (live: LiveBuffer) => void,
  onClose: (reason: string) => void,
): () => void {
  const socket = new WebSocket(address);
  socket.binaryType = "arraybuffer";
  let live: LiveBuffer | null = null;
  let closed = false;
  socket.onmessage = ({ data }) => {
    if (data instanceof ArrayBuffer) {
      if (!live) return;
      live.samples(new Float32Array(data));
    } else {
      const message = JSON.parse(data as string) as LiveMessage;
      if (message.type === "header") live = new LiveBuffer(message, seconds);
      else if (!live) return;
      else if (message.type === "dda") live.result(message);
      else live.latestClass = message;
    }
    if (live) onChange(live);
  };
  socket.onclose = (event) => {
    if (closed) return;
    closed = true;
    onClose(
      live
        ? "The stream ended"
        : `Could not connect${event.code === 1006 ? ": is ddalab stream --serve running, with this token?" : ""}`,
    );
  };
  return () => {
    closed = true;
    socket.close();
  };
}
