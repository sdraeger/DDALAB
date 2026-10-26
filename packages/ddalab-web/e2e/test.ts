// The specs' `test`: Playwright's, with a guard on every page of the test's context. React's warning about a state
// update during another component's render fails the test that caused it, with the whole message: the components'
// names and React's component stack come as the message's arguments.
import { test as base, expect } from "@playwright/test";

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
