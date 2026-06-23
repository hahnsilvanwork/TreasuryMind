@echo off
setlocal
cd /d "%~dp0.."
title ReduitTreasuries - Setup ^& Start
rem node:sqlite needs this flag on Node 22.5-23.x; harmless on Node 24+ (where it is built-in).
set "NODE_OPTIONS=--experimental-sqlite"

echo ================================================
echo    ReduitTreasuries  -  Setup ^& Start
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Installing the latest LTS via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  echo.
  echo ^>^> Node.js was installed. Please CLOSE this window
  echo ^>^> and double-click START.cmd AGAIN.
  echo.
  pause
  exit /b 0
)

echo [1/5] Node.js found:
node -v
echo.

echo [2/5] Enabling pnpm (corepack)...
call corepack enable
call corepack prepare pnpm@9.12.0 --activate
echo.

echo [3/5] Preparing .env...
if not exist ".env" copy ".env.example" ".env" >nul
echo.

echo [4/5] Installing packages (the first time takes a few minutes)...
call pnpm install
if errorlevel 1 (
  echo.
  echo ERROR during "pnpm install".
  pause
  exit /b 1
)
call pnpm seed
echo.

echo [5/5] Starting the app... the browser opens automatically at http://localhost:5173
echo (To stop: close this window or press Ctrl+C)
echo.
call pnpm dev

pause
