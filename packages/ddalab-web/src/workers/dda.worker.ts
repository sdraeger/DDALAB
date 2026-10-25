import { instantiateCore } from "../core/abi";
import wasmUrl from "../core/ddalab.wasm?url";
import type { EngineVersion } from "../core/types";

export type WorkerRequest = { type: "version" };
export type WorkerReply = { type: "version"; version: EngineVersion } | { type: "error"; message: string };

// The engine has no file to read until a recording is opened.
const core = WebAssembly.compileStreaming(fetch(wasmUrl)).then((module) =>
  instantiateCore(module, () => {
    throw new Error("no file is open");
  }),
);

self.addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type !== "version") return;
  try {
    const reply: WorkerReply = { type: "version", version: (await core).version() };
    self.postMessage(reply);
  } catch (error) {
    const reply: WorkerReply = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(reply);
  }
});
