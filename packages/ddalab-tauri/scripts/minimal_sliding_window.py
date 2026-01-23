#!/usr/bin/env python3
"""
Minimal sliding window example - no dependencies

Shows the core concept of a double-ended buffer (deque) creating
a sliding window effect through logs.
"""

import sys
import time
from collections import deque


def clear_screen():
    """Clear terminal (works on Unix/Linux/macOS)"""
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


def progress_bar(current, total, width=40):
    """Generate ASCII progress bar"""
    filled = int(width * current / total)
    bar = "█" * filled + "░" * (width - filled)
    percent = 100 * current / total
    return f"[{bar}] {percent:5.1f}% ({current}/{total})"


class SlidingLogger:
    """Simple sliding log window using deque"""

    def __init__(self, max_lines=10):
        # deque with maxlen automatically removes oldest items
        self.buffer = deque(maxlen=max_lines)
        self.max_lines = max_lines

    def log(self, message):
        """Add a message (oldest automatically removed if full)"""
        self.buffer.append(message)

    def render(self):
        """Render the log window"""
        lines = []

        # Top border
        lines.append("╭─" + " Logs " + "─" * 50 + "╮")

        # Empty lines if buffer not full
        empty_lines = self.max_lines - len(self.buffer)
        for _ in range(empty_lines):
            lines.append("│" + " " * 56 + "│")

        # Log messages
        for msg in self.buffer:
            # Truncate if too long
            truncated = msg[:54] if len(msg) > 54 else msg
            lines.append(f"│ {truncated:<54} │")

        # Bottom border
        lines.append("╰" + "─" * 56 + "╯")

        return "\n".join(lines)


def demo():
    """Demo: Progress bar with sliding logs"""
    logger = SlidingLogger(max_lines=8)
    total = 50

    print("Sliding Log Window Demo\n")
    print("Watch how old logs scroll off the top as new ones appear!\n")
    time.sleep(2)

    for i in range(total + 1):
        # Clear screen and draw UI
        clear_screen()

        # Progress bar
        print(progress_bar(i, total))
        print()

        # Add log messages
        if i % 10 == 0:
            logger.log(f"✓ Checkpoint {i}/{total}")
        if i % 7 == 0:
            logger.log(f"→ Processing item {i}")
        if i % 13 == 0 and i > 0:
            logger.log(f"⚠ Warning at item {i}")

        # Render log window
        print(logger.render())
        print()
        print("Press Ctrl+C to stop")

        time.sleep(0.2)

    print("\n✓ Complete!\n")


if __name__ == "__main__":
    try:
        demo()
    except KeyboardInterrupt:
        print("\n\nStopped by user\n")
