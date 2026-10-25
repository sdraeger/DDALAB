// The specs' `test`: Playwright's, with a guard on every page of the test's context. React's warning about a state
// update during another component's render fails the test that caused it.
import { test as base, expect } from "@playwright/test";

export type { Page } from "@playwright/test";
export { expect };

const RENDER_UPDATE = /Cannot update a component .* while rendering a different component/;

export const test = base.extend<{ renderUpdateGuard: undefined }>({
  renderUpdateGuard: [
    async ({ context }, use) => {
      const warnings: string[] = [];
      context.on("console", (message) => {
        if (RENDER_UPDATE.test(message.text())) warnings.push(message.text());
      });
      await use(undefined);
      expect(warnings, "a component updated another while rendering").toEqual([]);
    },
    { auto: true },
  ],
});
