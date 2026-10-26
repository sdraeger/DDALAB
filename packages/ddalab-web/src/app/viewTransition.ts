// Layout changes the user causes (a panel opening or closing, a result shown or closed, the theme) crossfade from the
// old page to the new one in a view transition, timed on the motion tokens in base.css. The page changes once inside
// it: the canvases resize once and redraw in the live new view. What mounts with the change appears through the
// crossfade alone: `data-view-transition` on <html> holds back the fade-in of base.css meanwhile, until the last of
// overlapping transitions ends. Browsers without view transitions change at once.
import { flushSync } from "react-dom";

let running = 0;

export function inTransition(update: () => void) {
  if (!document.startViewTransition) return update();
  const root = document.documentElement;
  running++;
  const transition = document.startViewTransition(() => {
    root.dataset.viewTransition = "";
    flushSync(update);
  });
  const done = () => {
    if (--running === 0) delete root.dataset.viewTransition;
  };
  transition.finished.then(done, done);
}
