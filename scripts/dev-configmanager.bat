@echo off
REM DDALAB ConfigManager Development Launcher for Windows
REM This script launches the configmanager in development mode with hot reloading

setlocal enabledelayedexpansion

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
set "CONFIGMANAGER_DIR=%PROJECT_ROOT%\packages\configmanager"

echo [INFO] Starting DDALAB ConfigManager in development mode...
echo [INFO] Project root: %PROJECT_ROOT%
echo [INFO] ConfigManager directory: %CONFIGMANAGER_DIR%

REM Check if we're in the right directory
if not exist "%CONFIGMANAGER_DIR%\package.json" (
    echo [ERROR] ConfigManager package.json not found at %CONFIGMANAGER_DIR%
    echo [ERROR] Please run this script from the DDALAB project root directory
    pause
    exit /b 1
)

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed. Please install npm first.
    pause
    exit /b 1
)

REM Check if dependencies are installed
if not exist "%CONFIGMANAGER_DIR%\node_modules" (
    echo [WARNING] Dependencies not installed. Installing now...
    cd /d "%CONFIGMANAGER_DIR%"
    npm install
    cd /d "%PROJECT_ROOT%"
)

REM Navigate to configmanager directory
cd /d "%CONFIGMANAGER_DIR%"

echo [INFO] Starting development mode with hot reloading...
echo [INFO] Press Ctrl+C to stop the development server

REM Start the development server
npm run dev

pause 