// Keeps a result view that throws (a record an older build stored malformed, a file it cannot read) from unmounting
// the app on every load: the view gives way to the reason and, when given, a way out. The history, the provenance
// and the result views each sit in one.
import { Component, type ReactNode } from "react";
import styles from "./History.module.css";

interface Props {
  /** What could not be shown, as the start of the message: "The history", "This result". */
  what: string;
  /** A control shown with the message, such as closing the result. */
  action?: ReactNode;
  children: ReactNode;
}

export class ResultBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={styles.failure}>
        <p role="alert" className={styles.error}>
          {this.props.what} could not be shown: {error.message}
        </p>
        {this.props.action}
      </div>
    );
  }
}
