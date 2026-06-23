@echo off
setlocal
cd /d "%~dp0.."
title ReduitTreasuries - On-chain Proof
set "NODE_OPTIONS=--experimental-sqlite"

echo ================================================
echo    ReduitTreasuries  -  On-chain Proof (Testnet)
echo ================================================
echo.
echo IMPORTANT: Run this on an UNBLOCKED network - a phone hotspot or
echo venue wifi. NOT a corporate LAN (it blocks the XRPL connection).
echo.
echo Optional, for REAL RLUSD: first send some RLUSD to the HQ address at
echo https://tryrlusd.com. Without it the proof uses XRP (also real
echo on-chain and satisfies the agent requirement).
echo.
pause

if not exist "apps\backend\node_modules" (
  echo.
  echo Packages are not installed yet - please run START.cmd first.
  pause
  exit /b 1
)

call corepack enable >nul 2>nul
call pnpm prove

echo.
echo Done. The two tx hashes and explorer links are in docs/ONCHAIN-PROOF.md
pause
