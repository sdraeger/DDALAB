#!/usr/bin/env bash
# Writes the winget manifests of a DDALAB release for a pull request to microsoft/winget-pkgs:
#   packaging/winget/manifests.sh <version> [out_dir]
# into <out_dir>/manifests/s/sdraeger/DDALAB/<version>/ (out_dir defaults to the current directory). Needs gh. The
# installer is the release's Windows zip, which holds ddalab.exe; winget installs it as a portable command.
set -euo pipefail
version=${1:?usage: manifests.sh <version> [out_dir]}
out=${2:-.}
repo=${DDALAB_REPO:-sdraeger/DDALAB}
asset=${DDALAB_ASSET:-ddalab-x86_64-pc-windows-msvc.zip}
id=sdraeger.DDALAB
dir="$out/manifests/s/sdraeger/DDALAB/$version"
tmp="$(mktemp -d)"
gh release download "v$version" --repo "$repo" --pattern "$asset.sha256" --dir "$tmp"
hash="$(cut -d ' ' -f 1 "$tmp/$asset.sha256" | tr '[:lower:]' '[:upper:]')"
[[ "$hash" =~ ^[0-9A-F]{64}$ ]] || { echo "Unexpected checksum file: $(cat "$tmp/$asset.sha256")" >&2; exit 1; }
mkdir -p "$dir"
schema=1.12.0
cat > "$dir/$id.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.version.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: $schema
YAML
cat > "$dir/$id.installer.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.installer.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $version
InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
  - RelativeFilePath: ddalab.exe
    PortableCommandAlias: ddalab
Installers:
  - Architecture: x64
    InstallerUrl: https://github.com/$repo/releases/download/v$version/$asset
    InstallerSha256: $hash
ManifestType: installer
ManifestVersion: $schema
YAML
cat > "$dir/$id.locale.en-US.yaml" <<YAML
# yaml-language-server: \$schema=https://aka.ms/winget-manifest.defaultLocale.$schema.schema.json
PackageIdentifier: $id
PackageVersion: $version
PackageLocale: en-US
Publisher: Simon Dräger
PublisherUrl: https://github.com/sdraeger
PackageName: DDALAB
PackageUrl: https://github.com/sdraeger/DDALAB
License: MIT
LicenseUrl: https://github.com/sdraeger/DDALAB/blob/main/LICENSE
ShortDescription: Delay differential analysis of EEG, iEEG and other multichannel recordings (the ddalab command line)
Moniker: ddalab
Tags:
  - dda
  - eeg
  - ieeg
  - neuroscience
  - time-series
ReleaseNotesUrl: https://github.com/sdraeger/DDALAB/releases/tag/v$version
ManifestType: defaultLocale
ManifestVersion: $schema
YAML
echo "$dir"
