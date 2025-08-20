@echo off
SETLOCAL

REM Check for Docker Desktop installation and running status
REM This script assumes Docker Desktop is installed and running.

ECHO Building DDALAB Docker image...

REM Build the DDALAB image
docker build --file "Dockerfile" --tag "sdraeger1/ddalab:latest" .
IF %ERRORLEVEL% NEQ 0 (
    ECHO Error: Docker image build failed.
    GOTO :eof
)

ECHO Docker images built successfully.

ENDLOCAL 