@echo off
REM DDALAB Management Script for Windows (Batch)

if "%1"=="" goto usage

powershell -ExecutionPolicy Bypass -File "%~dp0ddalab.ps1" %1
goto end

:usage
echo.
echo DDALAB Management Tool
echo.
echo Usage: ddalab.bat [command]
echo.
echo Commands:
echo   start    - Start DDALAB (sets up environment if needed)
echo   stop     - Stop DDALAB  
echo   restart  - Restart DDALAB
echo   logs     - Show service logs
echo   status   - Show service status
echo   backup   - Create database backup
echo.

:end