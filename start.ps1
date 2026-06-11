# TreasuryMind - Start Script (PowerShell)
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  TreasuryMind - XRPL AI Treasury    " -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

$backendDir  = "$PSScriptRoot\backend"
$frontendDir = "$PSScriptRoot\frontend"

# .env check
if (-not (Test-Path "$backendDir\.env")) {
    Write-Host "`n[!] No .env found. Creating empty one..." -ForegroundColor Yellow
    if (Test-Path "$backendDir\.env.example") {
        Copy-Item "$backendDir\.env.example" "$backendDir\.env"
    } else {
        New-Item "$backendDir\.env" -ItemType File | Out-Null
    }
    Write-Host "    Edit backend\.env and add your GROQ_API_KEY" -ForegroundColor Yellow
}

# Find Python - prefer py launcher (has all packages installed)
$pyExe = (Get-Command py -ErrorAction SilentlyContinue).Source
if (-not $pyExe) {
    $pyExe = (Get-Command python -ErrorAction SilentlyContinue).Source
}
if (-not $pyExe) {
    Write-Host "[X] Python not found. Install Python 3.11+ and add to PATH." -ForegroundColor Red
    exit 1
}
Write-Host "`n    Python: $pyExe" -ForegroundColor Gray

# Find npm
$npmExe = (Get-Command npm -ErrorAction SilentlyContinue).Source
if (-not $npmExe) {
    Write-Host "[X] npm not found. Install Node.js from https://nodejs.org" -ForegroundColor Red
    exit 1
}
Write-Host "    npm:    $npmExe" -ForegroundColor Gray

# Start Backend (WorkingDirectory sets the folder — no cd needed)
Write-Host "`n[1/2] Starting FastAPI backend on http://localhost:8000 ..." -ForegroundColor Green
Start-Process powershell `
    -WorkingDirectory $backendDir `
    -ArgumentList "-NoExit", "-Command", "& '$pyExe' -m uvicorn main:app --reload --port 8000"

# Wait for backend to be ready (poll health endpoint — XRPL init can take 15-30s)
Write-Host "      Waiting for backend to initialize (XRPL setup ~20s)..." -ForegroundColor Gray
$ready = $false
for ($i = 1; $i -le 40; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Write-Host "      Still waiting... ($($i*2)s)" -ForegroundColor DarkGray
}
if ($ready) {
    Write-Host "      Backend ready!" -ForegroundColor Green
} else {
    Write-Host "      Backend didn't respond in 80s — starting frontend anyway." -ForegroundColor Yellow
}

# Start Frontend
Write-Host "[2/2] Starting Next.js frontend on http://localhost:3000 ..." -ForegroundColor Green
Start-Process powershell `
    -WorkingDirectory $frontendDir `
    -ArgumentList "-NoExit", "-Command", "npm install; npm run dev"

# Done
Write-Host "`n[OK] TreasuryMind is starting up!" -ForegroundColor Cyan
Write-Host "     Frontend : http://localhost:3000" -ForegroundColor White
Write-Host "     Backend  : http://localhost:8000/docs" -ForegroundColor White
Write-Host "     AI Model : Groq llama-3.3-70b (free)" -ForegroundColor Gray
Write-Host "     XRPL     : Devnet" -ForegroundColor Gray
Write-Host "`nPress any key to close this launcher..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
