#!/usr/bin/env python3
"""
Terminal UI with progress bar and sliding log window

Shows a progress bar at the top and a fixed-size log window below it
that slides through log messages like a moving window.

Install: pip install rich
"""

import time
from collections import deque

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TextColumn,
    TimeRemainingColumn,
)


class SlidingLogger:
    """Logger with a fixed-size sliding window of messages"""

    def __init__(self, max_lines: int = 10):
        self.max_lines = max_lines
        self.buffer = deque(maxlen=max_lines)  # Double-ended queue with max size

    def log(self, message: str):
        """Add a log message (old messages automatically scroll off)"""
        self.buffer.append(message)

    def render(self) -> Panel:
        """Render the log window as a Rich Panel"""
        # Join all messages with newlines
        content = "\n".join(self.buffer) if self.buffer else "[dim]No logs yet...[/dim]"

        # Create panel with border
        return Panel(
            content,
            title=f"[bold cyan]Logs[/bold cyan] ({len(self.buffer)}/{self.max_lines})",
            border_style="cyan",
            height=self.max_lines + 2,  # +2 for borders
        )


def demo_progress_with_logs():
    """Demo: Progress bar with sliding log window"""
    console = Console()
    logger = SlidingLogger(max_lines=10)

    # Create layout
    layout = Layout()
    layout.split_column(
        Layout(name="progress", size=3),
        Layout(name="logs"),
    )

    # Create progress bar
    progress = Progress(
        SpinnerColumn(),
        TextColumn("[bold blue]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
        TimeRemainingColumn(),
    )

    task = progress.add_task("[cyan]Processing...", total=100)

    # Update display in real-time
    with Live(layout, console=console, refresh_per_second=10):
        for i in range(100):
            # Update progress
            progress.update(task, advance=1)

            # Add log messages (some steps generate more logs)
            if i % 10 == 0:
                logger.log(f"[green]✓[/green] Checkpoint {i}/100 reached")
            if i % 23 == 0:
                logger.log(f"[yellow]⚠[/yellow] Processing batch {i // 23 + 1}")
            if i % 7 == 0:
                logger.log(f"[dim]Debug: Processing item {i}[/dim]")

            # Update layout
            layout["progress"].update(Panel(progress, border_style="blue"))
            layout["logs"].update(logger.render())

            time.sleep(0.1)

        # Final message
        logger.log("[bold green]✓ Processing complete![/bold green]")
        layout["logs"].update(logger.render())
        time.sleep(2)


def demo_with_errors():
    """Demo: Show how errors appear in the sliding window"""
    console = Console()
    logger = SlidingLogger(max_lines=8)

    layout = Layout()
    layout.split_column(
        Layout(name="progress", size=3),
        Layout(name="logs"),
    )

    progress = Progress(
        SpinnerColumn(),
        TextColumn("[bold blue]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
    )

    task = progress.add_task("[cyan]Processing files...", total=50)

    with Live(layout, console=console, refresh_per_second=10):
        for i in range(50):
            progress.update(task, advance=1)

            # Simulate different types of log messages
            if i % 15 == 0 and i > 0:
                logger.log(f"[bold red]✗ Error:[/bold red] File {i} corrupted")
            elif i % 5 == 0:
                logger.log(f"[green]✓[/green] Processed file_{i:03d}.edf")
            else:
                logger.log(f"[dim]→ Reading file_{i:03d}.edf[/dim]")

            layout["progress"].update(Panel(progress, border_style="blue"))
            layout["logs"].update(logger.render())

            time.sleep(0.15)

        logger.log("[bold green]✓ All files processed![/bold green]")
        layout["logs"].update(logger.render())
        time.sleep(2)


def demo_multibar_with_logs():
    """Demo: Multiple progress bars with shared log window"""
    console = Console()
    logger = SlidingLogger(max_lines=12)

    layout = Layout()
    layout.split_column(
        Layout(name="progress", size=5),
        Layout(name="logs"),
    )

    progress = Progress(
        TextColumn("[bold blue]{task.description}"),
        BarColumn(),
        TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
    )

    download_task = progress.add_task("[cyan]Downloading", total=100)
    process_task = progress.add_task("[magenta]Processing", total=100)

    with Live(layout, console=console, refresh_per_second=10):
        for i in range(100):
            # Download is faster
            if i < 100:
                progress.update(download_task, advance=1.5)
                if i % 10 == 0:
                    logger.log(f"[cyan]↓[/cyan] Downloaded chunk {i // 10 + 1}")

            # Processing is slower
            progress.update(process_task, advance=1)
            if i % 15 == 0:
                logger.log(f"[magenta]⚙[/magenta] Processed {i} items")

            layout["progress"].update(Panel(progress, border_style="blue"))
            layout["logs"].update(logger.render())

            time.sleep(0.08)

        logger.log("[bold green]✓ Download complete![/bold green]")
        logger.log("[bold green]✓ Processing complete![/bold green]")
        layout["logs"].update(logger.render())
        time.sleep(2)


if __name__ == "__main__":
    console = Console()

    console.print("\n[bold cyan]Demo 1:[/bold cyan] Basic progress with sliding logs\n")
    demo_progress_with_logs()

    console.print("\n[bold cyan]Demo 2:[/bold cyan] Progress with errors in logs\n")
    demo_with_errors()

    console.print("\n[bold cyan]Demo 3:[/bold cyan] Multiple progress bars\n")
    demo_multibar_with_logs()

    console.print("\n[bold green]✓ All demos complete![/bold green]\n")
