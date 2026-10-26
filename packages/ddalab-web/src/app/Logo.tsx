// The DDALAB mark: a D with a delay-embedding loop cut out of it, a state point on the loop and an echo of the bowl
// one delay to the right. The colors are the theme's tokens. The wordmark beside it carries the name.
import { useId } from "react";
import styles from "./Logo.module.css";

export function Logo() {
  const mask = useId();
  return (
    // The viewBox ends at the D's base (y 26) so the base sits on the text baseline; the echo's round cap overshoots it.
    <svg className={styles.logo} viewBox="5 4.5 23.5 21.5" aria-hidden>
      <mask id={mask}>
        <rect x="0" y="0" width="32" height="32" fill="#fff" />
        <ellipse
          cx="13.5"
          cy="16"
          rx="6.3"
          ry="2.9"
          transform="rotate(-45 13.5 16)"
          fill="none"
          stroke="#000"
          strokeWidth="2.1"
        />
        <circle cx="17.95" cy="11.55" r="3.1" fill="#000" />
      </mask>
      <path className={styles.d} d="M5 6H12A10 10 0 0 1 12 26H5Z" mask={`url(#${mask})`} />
      <circle className={styles.point} cx="17.95" cy="11.55" r="2.05" />
      <path className={styles.echo} d="M17 6A10 10 0 0 1 17 26" />
    </svg>
  );
}
