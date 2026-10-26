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

// Playwright's WebKit has no OPFS (getDirectory throws UnknownError); Safari itself has.
export const hasStorage = (page: Page) =>
  page.evaluate(() =>
    navigator.storage.getDirectory().then(
      () => true,
      () => false,
    ),
  );
export const NO_STORAGE = "this browser window has no OPFS";

// Headless Firefox on Linux makes no WebGL context ("AllowWebgl2:false restricts context creation on this system"),
// and the waveform and the heatmap draw only with WebGL2. The probe's context is released at once.
export const hasWebGL2 = (page: Page) =>
  page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  });
export const NO_WEBGL2 = "this browser makes no WebGL2 context (headless Firefox on Linux)";

/** The overview scan is over: at 100%, or not stored at all in a window without OPFS (Playwright's WebKit). */
export const scanned = (page: Page) => page.getByText(/^Overview 100%$|no overview is stored\.$/);
