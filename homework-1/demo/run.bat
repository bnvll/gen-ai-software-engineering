@echo off
REM Starts the Banking Transactions API on Windows.
REM
REM Usage:
REM   demo\run.bat            start on :3000 with the demo ledger preloaded
REM   demo\run.bat --no-seed  start with an empty ledger
setlocal

cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found on PATH. Install Node.js 20 or newer.
  exit /b 1
)

if not exist node_modules (
  echo ==^> Installing dependencies ^(npm install^)
  call npm install --no-audit --no-fund
)

if "%PORT%"=="" set PORT=3000
set SEED_FILE=demo\sample-data.json
if "%1"=="--no-seed" set SEED_FILE=

echo ==^> Starting API on http://localhost:%PORT%
echo ==^> Press Ctrl+C to stop
echo.

node src\index.js
