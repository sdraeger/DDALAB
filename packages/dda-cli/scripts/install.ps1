#Requires -Version 5.1
# DDALAB CLI Installer for Windows
# Usage: irm https://raw.githubusercontent.com/sdraeger/DDALAB/main/packages/dda-cli/scripts/install.ps1 | iex

$ErrorActionPreference = "Stop"

$Repo = "sdraeger/DDALAB"
$BinaryName = "ddalab-windows-x64.exe"
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { "$env:LOCALAPPDATA\ddalab" }
$Version = if ($env:VERSION) { $env:VERSION } else { "latest" }

if ($Version -eq "latest") {
    $Url = "https://github.com/$Repo/releases/latest/download/$BinaryName"
} else {
    $Url = "https://github.com/$Repo/releases/download/v$Version/$BinaryName"
}

Write-Host "Installing ddalab CLI..."
Write-Host "  Install to: $InstallDir"
Write-Host ""

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Invoke-WebRequest -Uri $Url -OutFile "$InstallDir\ddalab.exe"

# Add to user PATH if not already there
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($UserPath -notlike "*$InstallDir*") {
    $NewPath = if ($UserPath) { "$UserPath;$InstallDir" } else { $InstallDir }
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    Write-Host "Added $InstallDir to user PATH."
    Write-Host "Restart your terminal for PATH changes to take effect."
    Write-Host ""
}

Write-Host "Installed: $(& "$InstallDir\ddalab.exe" --version 2>$null)"
Write-Host "Run 'ddalab --help' to get started."
