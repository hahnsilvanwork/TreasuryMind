@echo off
setlocal
cd /d "%~dp0.."
title ReduitTreasuries - Full Demo Start
set "NODE_OPTIONS=--experimental-sqlite"

echo ================================================
echo    ReduitTreasuries  -  Full Demo Start
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please run START.cmd first.
  pause
  exit /b 1
)

echo [1/4] Enabling pnpm...
call corepack enable >nul 2>nul
call corepack prepare pnpm@9.12.0 --activate >nul 2>nul
echo.

echo [2/4] Preparing .env and installing packages...
if not exist ".env" copy ".env.example" ".env" >nul
call pnpm install
if errorlevel 1 (
  echo ERROR during pnpm install.
  pause
  exit /b 1
)
call pnpm seed
echo.

echo [3/4] On-chain proof (XRPL Testnet)...
echo.
echo IMPORTANT: use a phone hotspot or open Wi-Fi (not a corporate network).
echo.
pause

call pnpm prove
if errorlevel 1 (
  echo ERROR during the on-chain proof.
  pause
  exit /b 1
)
echo.

echo Seeding the DB with the real wallet addresses...
call pnpm seed
echo.

echo [4/4] Starting the app at http://localhost:5173 ...
echo (To stop: close this window or press Ctrl+C)
echo.
call pnpm dev

pause
