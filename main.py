"""DDA Lab application entry point."""

import sys

from PyQt6.QtWidgets import QApplication

from ddalab.gui import DDALabWindow


def main():
    """Application entry point."""
    app = QApplication(sys.argv)
    window = DDALabWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
