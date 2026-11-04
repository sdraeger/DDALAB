// A name that keeps its end when it does not fit, since names that share a start (LAH10, LAH11; run-01, run-02 of one
// BIDS subject) differ at their end. It is cut only at a space: the two parts are flex items, between which screen
// readers and accessible names put a space, so a cut inside a word would change the name. The longer part shrinks:
// a start elides at its end ("Left An… 10"), as does an end ("EEG Fp1-…"), but a file name's at its start
// ("ST on …run-01_ieeg.vhdr"). The title gives it whole.
import styles from "./MiddleText.module.css";

/** The most characters an end after a space keeps whole. */
const END = 8;

/**
 * `text` cut after a space, which stays with the start: before the longest end of at most 8 characters that follows a
 * space ("10", "10 & DC"), else after its last space; a name with neither is all end. (A space at the start of a right
 * to left end would not show.)
 */
export function splitEnd(text: string): [string, string] {
  let cut = -1;
  for (let i = text.length - 1; i > 0 && text.length - i - 1 <= END; i--) if (text[i] === " ") cut = i;
  if (cut < 0) cut = text.lastIndexOf(" ");
  return cut > 0 ? [text.slice(0, cut + 1), text.slice(cut + 1)] : ["", text];
}

/** `file`: the name ends in a file name, whose end tells it apart (run-01_ieeg.vhdr): when it shrinks, its start elides. */
export function MiddleText({ text, file, className }: { text: string; file?: boolean; className?: string }) {
  const [head, end] = splitEnd(text);
  return (
    <span
      className={className ? `${styles.middle} ${className}` : styles.middle}
      title={text}
      data-end-shrinks={end.length > head.length || undefined}
      data-file={file || undefined}
    >
      {head && <span className={styles.head}>{head}</span>}
      <span className={styles.end}>
        <span dir="ltr">{end}</span>
      </span>
    </span>
  );
}
