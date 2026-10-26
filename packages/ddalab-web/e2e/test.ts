// The specs' `test`: Playwright's, with a guard on every page of the test's context. React's warning about a state
// update during another component's render fails the test that caused it, with the whole message: the components'
// names and React's component stack come as the message's arguments.
import { test as base, expect, type Page } from "@playwright/test";

export type { Page } from "@playwright/test";
export { expect };

const RENDER_UPDATE = /Cannot update a component .* while rendering a different component/;

export const test = base.extend<{ renderUpdateGuard: undefined }>({
  renderUpdateGuard: [
    async ({ context }, use) => {
      const warnings: Promise<string>[] = [];
      context.on("console", (message) => {
        if (!RENDER_UPDATE.test(message.text())) return;
        const args = message.args().map((arg) => arg.jsonValue().then(String, () => String(arg)));
        warnings.push(Promise.all(args).then((parts) => [message.text(), ...parts].join("\n")));
      });
      await use(undefined);
      expect(await Promise.all(warnings), "a component updated another while rendering").toEqual([]);
    },
    { auto: true },
  ],
});

/** `ok`, or a failed test where `capability` is missing outside the one project CI runs without it. */
function expected(ok: boolean, capability: string, missingIn: string) {
  const { name } = test.info().project;
  if (!ok && name !== missingIn) throw new Error(`${name} has no ${capability}`);
  return ok;
}

// Playwright's WebKit has no OPFS (getDirectory throws UnknownError); Safari itself has.
export const hasStorage = async (page: Page) =>
  expected(
    await page.evaluate(() =>
      navigator.storage.getDirectory().then(
        () => true,
        () => false,
      ),
    ),
    "OPFS",
    "webkit",
  );
export const NO_STORAGE = "this browser window has no OPFS";

// Headless Firefox on Linux makes no WebGL context ("AllowWebgl2:false restricts context creation on this system"),
// and the waveform and the heatmap draw only with WebGL2. The probe asks for the app's context (render/gl.ts) and
// releases it at once.
export const hasWebGL2 = async (page: Page) =>
  expected(
    await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2", { antialias: false, depth: false });
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
      return gl !== null;
    }),
    "WebGL2",
    "firefox",
  );
export const NO_WEBGL2 = "this browser makes no WebGL2 context (headless Firefox on Linux)";

/** The overview scan is over: at 100%, or, in Playwright's WebKit, which has no OPFS, not stored at all. */
export const scanned = (page: Page) =>
  page.getByText(
    test.info().project.name === "webkit" ? /^Overview 100%$|no overview is stored\.$/ : "Overview 100%",
  );
