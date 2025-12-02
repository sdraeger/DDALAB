#!/bin/bash
# sync-packages.sh
# Syncs DDA packages (dda-py and DelayDifferentialAnalysis.jl) to their external repositories
#
# Usage:
#   ./scripts/sync-packages.sh [--python] [--julia] [--all] [--push] [--tag VERSION]
#
# Options:
#   --python    Sync dda-py package only
#   --julia     Sync DelayDifferentialAnalysis.jl package only
#   --all       Sync all packages (default if no package specified)
#   --push      Push changes to remote
#   --tag VER   Create and push a git tag (e.g., --tag v1.0.1)
#
# Examples:
#   ./scripts/sync-packages.sh --all --push          # Push both packages
#   ./scripts/sync-packages.sh --julia --tag v0.1.3  # Tag Julia package for registry

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PYTHON_PKG="$PROJECT_ROOT/packages/dda-py"
JULIA_PKG="$PROJECT_ROOT/packages/DelayDifferentialAnalysis.jl"

# Parse arguments
SYNC_PYTHON=false
SYNC_JULIA=false
DO_PUSH=false
TAG_VERSION=""

for arg in "$@"; do
    case $arg in
        --python)
            SYNC_PYTHON=true
            ;;
        --julia)
            SYNC_JULIA=true
            ;;
        --all)
            SYNC_PYTHON=true
            SYNC_JULIA=true
            ;;
        --push)
            DO_PUSH=true
            ;;
        --tag)
            # Next argument is the version
            ;;
        v*)
            TAG_VERSION="$arg"
            ;;
        *)
            if [[ "$arg" =~ ^[0-9] ]]; then
                TAG_VERSION="v$arg"
            elif [[ ! "$arg" =~ ^-- ]]; then
                echo "Unknown option: $arg"
                exit 1
            fi
            ;;
    esac
done

# Default to all packages if none specified
if [ "$SYNC_PYTHON" = false ] && [ "$SYNC_JULIA" = false ]; then
    SYNC_PYTHON=true
    SYNC_JULIA=true
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "DDA Package Sync"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

sync_package() {
    local PKG_DIR="$1"
    local PKG_NAME="$2"

    echo "📦 Syncing $PKG_NAME..."
    cd "$PKG_DIR"

    # Show status
    echo "   Status:"
    git status --short

    # Check for uncommitted changes
    if [ -n "$(git status --porcelain)" ]; then
        echo ""
        echo "   ⚠️  Uncommitted changes detected. Please commit first."
        return 1
    fi

    # Push if requested
    if [ "$DO_PUSH" = true ]; then
        echo "   🚀 Pushing to remote..."
        git push origin main
        echo "   ✅ Pushed"
    fi

    # Tag if requested
    if [ -n "$TAG_VERSION" ]; then
        echo "   🏷️  Creating tag: $TAG_VERSION"
        git tag -a "$TAG_VERSION" -m "Release $TAG_VERSION"

        if [ "$DO_PUSH" = true ]; then
            echo "   🚀 Pushing tag..."
            git push origin "$TAG_VERSION"
            echo "   ✅ Tag pushed"
        else
            echo "   💡 Run with --push to push the tag"
        fi
    fi

    echo ""
}

# Sync Python package
if [ "$SYNC_PYTHON" = true ]; then
    sync_package "$PYTHON_PKG" "dda-py"
fi

# Sync Julia package
if [ "$SYNC_JULIA" = true ]; then
    sync_package "$JULIA_PKG" "DelayDifferentialAnalysis.jl"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Sync complete!"
echo ""

if [ "$SYNC_JULIA" = true ] && [ -n "$TAG_VERSION" ]; then
    echo "📝 Julia Registry Instructions:"
    echo "   1. Go to: https://github.com/sdraeger/DelayDifferentialAnalysis.jl"
    echo "   2. Comment on a commit: @JuliaRegistrator register"
    echo "   3. Or: Comment on a release: @JuliaRegistrator register"
    echo ""
fi

if [ "$SYNC_PYTHON" = true ] && [ -n "$TAG_VERSION" ]; then
    echo "📝 PyPI Instructions:"
    echo "   The GitHub Action will automatically publish to PyPI when a tag is pushed."
    echo "   Make sure you have configured the 'pypi' environment in GitHub repository settings."
    echo ""
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
