import { useEffect, useState } from "react";
import type { WorkerReply, WorkerRequest } from "../workers/dda.worker";

export function App() {
  const [engine, setEngine] = useState("loading");

  useEffect(() => {
    const worker = new Worker(new URL("../workers/dda.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) =>
      setEngine(data.type === "version" ? data.version.engine_version : `failed: ${data.message}`);
    const request: WorkerRequest = { type: "version" };
    worker.postMessage(request);
    return () => worker.terminate();
  }, []);

  return (
    <main>
      <h1>DDALAB</h1>
      <p>
        Engine <output>{engine}</output>
      </p>
    </main>
  );
}
