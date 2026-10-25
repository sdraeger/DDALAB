import { Suspense, use } from "react";
import { Inspector } from "./Inspector";
import { Open } from "./Open";
import { engine } from "./recordings";

const version = engine.version().then(
  (v) => v.engine_version,
  (error: Error) => `failed: ${error.message}`,
);

function EngineVersion() {
  return <output>{use(version)}</output>;
}

export function App() {
  return (
    <main>
      <h1>DDALAB</h1>
      <p>
        Engine{" "}
        <Suspense fallback={<output>loading</output>}>
          <EngineVersion />
        </Suspense>
      </p>
      <Open />
      <Inspector />
    </main>
  );
}
