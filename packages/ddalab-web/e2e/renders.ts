// Counts React renders by component name in dev builds, through the hook React offers its developer tools: each commit
// reports its root, and a component rendered in it when its fiber is new or carries React's PerformedWork flag. A
// subtree the commit took over unchanged from the one before is skipped, as the developer tools skip it.
import type { Page } from "@playwright/test";

/** Installs the counter before the page's scripts run; call it before `page.goto` or `page.reload`. */
export const countRenders = (page: Page) =>
  page.addInitScript(() => {
    interface Fiber {
      child: Fiber | null;
      sibling: Fiber | null;
      alternate: Fiber | null;
      flags: number;
      type: unknown;
    }
    const counts: Record<string, number> = {};
    const walk = (parent: Fiber) => {
      for (let fiber = parent.child; fiber; fiber = fiber.sibling) {
        const before = fiber.alternate;
        if (typeof fiber.type === "function" && (!before || (fiber.flags & 1) === 1)) {
          const { name } = fiber.type as { name: string };
          counts[name] = (counts[name] ?? 0) + 1;
        }
        if (!before || fiber.child !== before.child) walk(fiber);
      }
    };
    Object.assign(window, {
      __renders: counts,
      // React Refresh (the dev server) wraps `inject` and `onCommitFiberRoot` and reads `renderers`.
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        renderers: new Map(),
        supportsFiber: true,
        inject: () => 1,
        checkDCE() {},
        onCommitFiberRoot: (_: number, root: { current: Fiber }) => walk(root.current),
        onCommitFiberUnmount() {},
      },
    });
  });

/** The renders of each component so far. */
export const renders = (page: Page) =>
  page.evaluate(() => ({ ...(window as unknown as { __renders: Record<string, number> }).__renders }));
