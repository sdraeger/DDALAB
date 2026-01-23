gh release create v1.0.23 --title "v1.0.23" --notes "$(cat <<'EOF'

## What's Changed

### Refactoring & Cleanup

- **Rename Julia package**: `dda-jl` → `DelayDifferentialAnalysis.jl` with proper Julia package structure
- **Simplify codegen output**: Generated code now placed directly in target packages (removed `generated/` subdirectories)
- **Remove unused package**: Deleted legacy `dda-codegen` (replaced by `dda-spec`)
- **Clean up npm scripts**: Removed 25 broken scripts referencing deleted files
- **Add .prettierignore**: Exclude `docs-dist/` from formatting

### Developer Experience

- Cleaner imports: `from dda_py import DDARunner` instead of `from dda_py.generated import DDARunner`
- Streamlined package.json with only functional scripts

---

## Installation

### Download the appropriate file for your operating system:

| Operating System          | File to Download            | Notes                            |
| ------------------------- | --------------------------- | -------------------------------- |
| **macOS (Apple Silicon)** | `DDALAB_aarch64.app.tar.gz` | For M1/M2/M3 Macs                |
| **macOS (Intel)**         | `DDALAB_x64.app.tar.gz`     | For Intel-based Macs             |
| **Windows**               | `DDALAB_x64-setup.exe`      | Standard installer               |
| **Linux (Debian/Ubuntu)** | `ddalab_amd64.deb`          | Use `dpkg -i` or double-click    |
| **Linux (AppImage)**      | `ddalab_amd64.AppImage`     | Portable, no installation needed |

### Installation Instructions

**macOS:**

1. Download the appropriate `.app.tar.gz` file
2. Extract the archive: `tar -xzf DDALAB_*.app.tar.gz`
3. Move `DDALAB.app` to your Applications folder
4. Right-click and select "Open" the first time (to bypass Gatekeeper)

**Windows:**

1. Download `DDALAB_x64-setup.exe`
2. Run the installer
3. Follow the installation wizard

**Linux (Debian/Ubuntu):**

```bash
sudo dpkg -i ddalab_amd64.deb
```

**Linux (AppImage):**

```bash
chmod +x ddalab_amd64.AppImage
./ddalab_amd64.AppImage
```

---

**Full Changelog**: https://github.com/sdraeger/DDALAB/compare/v1.0.22...v1.0.23
EOF
)"

gh workflow run release.yml --ref v1.0.23 -f version=1.0.23 -f prerelease=false
