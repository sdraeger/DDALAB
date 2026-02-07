#!/bin/sh
set -e

# DDALAB CLI Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/sdraeger/DDALAB/main/packages/dda-cli/scripts/install.sh | sh

REPO="sdraeger/DDALAB"
VERSION="${VERSION:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Darwin) PLATFORM="macos" ;;
    Linux)  PLATFORM="linux" ;;
    *)      echo "Error: Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
    x86_64|amd64)  ARCH_LABEL="x64" ;;
    arm64|aarch64) ARCH_LABEL="arm64" ;;
    *)             echo "Error: Unsupported architecture: $ARCH"; exit 1 ;;
esac

BINARY_NAME="ddalab-${PLATFORM}-${ARCH_LABEL}"

if [ "$VERSION" = "latest" ]; then
    URL="https://github.com/${REPO}/releases/latest/download/${BINARY_NAME}"
else
    URL="https://github.com/${REPO}/releases/download/v${VERSION}/${BINARY_NAME}"
fi

echo "Installing ddalab CLI..."
echo "  Platform: ${PLATFORM} (${ARCH_LABEL})"
echo "  Install to: ${INSTALL_DIR}"
echo ""

mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" -o "${INSTALL_DIR}/ddalab"
chmod +x "${INSTALL_DIR}/ddalab"

# Check if install dir is in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "^${INSTALL_DIR}$"; then
    SHELL_NAME="$(basename "${SHELL:-/bin/sh}")"
    case "$SHELL_NAME" in
        zsh)  RC_FILE="$HOME/.zshrc" ;;
        bash) RC_FILE="$HOME/.bashrc" ;;
        fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
        *)    RC_FILE="" ;;
    esac

    echo "NOTE: ${INSTALL_DIR} is not in your PATH."
    if [ -n "$RC_FILE" ]; then
        echo "  Add it with:"
        echo "    echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ${RC_FILE}"
        echo "    source ${RC_FILE}"
    else
        echo "  Add it with:"
        echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
    fi
    echo ""
fi

echo "Installed: $("${INSTALL_DIR}/ddalab" --version 2>/dev/null || echo "ddalab")"
echo "Run 'ddalab --help' to get started."
