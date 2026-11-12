# KAAMSETU Windows launcher
# Run this script from any current directory; paths are resolved from this file.
$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$backendDir = Join-Path $projectRoot "kaamsetu-backend"
$frontendDir = Join-Path $projectRoot "kaamsetu-frontend"

if (-not (Test-Path (Join-Path $backendDir "package.json"))) {
    Write-Host "ERROR: Backend package.json was not found." -ForegroundColor Red
    Write-Host "Expected: $backendDir"
    Write-Host "Make sure this script is inside the extracted KaamSetu-Combined folder."
    exit 1
}
if (-not (Test-Path (Join-Path $frontendDir "index.html"))) {
    Write-Host "ERROR: Frontend index.html was not found." -ForegroundColor Red
    Write-Host "Expected: $frontendDir"
    Write-Host "Re-extract the complete ZIP if the frontend folder is missing."
    exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $node -or -not $npm) {
    Write-Host "ERROR: Node.js/npm was not found in PATH." -ForegroundColor Red
    Write-Host "Install Node.js 22.13 or newer from https://nodejs.org/ and reopen VS Code."
    exit 1
}

$nodeVersionText = (& node --version).Trim()
if ($nodeVersionText -notmatch '^v(\d+)\.(\d+)\.(\d+)') {
    Write-Host "ERROR: Could not read the Node.js version: $nodeVersionText" -ForegroundColor Red
    exit 1
}
$major = [int]$Matches[1]
$minor = [int]$Matches[2]
$patch = [int]$Matches[3]
if (($major -lt 22) -or (($major -eq 22) -and (($minor -lt 13) -or (($minor -eq 13) -and ($patch -lt 0))))) {
    Write-Host "ERROR: KAAMSETU requires Node.js 22.13 or newer. Found $nodeVersionText" -ForegroundColor Red
    exit 1
}

$port = 3000
if ($env:PORT) {
    $parsedPort = 0
    if ([int]::TryParse($env:PORT, [ref]$parsedPort) -and $parsedPort -ge 1 -and $parsedPort -le 65535) {
        $port = $parsedPort
    } else {
        Write-Host "ERROR: PORT must be an integer from 1 to 65535." -ForegroundColor Red
        exit 1
    }
}

$tcp = $null
try {
    $tcp = [System.Net.Sockets.TcpClient]::new()
    $connect = $tcp.BeginConnect("127.0.0.1", $port, $null, $null)
    if ($connect.AsyncWaitHandle.WaitOne(250) -and $tcp.Connected) {
        Write-Host "ERROR: Port $port is already accepting connections." -ForegroundColor Yellow
        Write-Host "A server may already be running. Open http://127.0.0.1:$port/ or stop the other process before starting another."
        Write-Host "To use another port, run: `$env:PORT = '3001' and then run this script again."
        exit 1
    }
} finally {
    if ($tcp) { $tcp.Close() }
}

$env:STATIC_DIR = $frontendDir
Write-Host ""
Write-Host "KAAMSETU startup checks passed." -ForegroundColor Green
Write-Host "Project:  $projectRoot"
Write-Host "Backend:  $backendDir"
Write-Host "Frontend: $frontendDir"
Write-Host "Node.js:  $nodeVersionText"
Write-Host "Address:  http://127.0.0.1:$port/"
Write-Host ""
Write-Host "Keep this terminal open while using KAAMSETU. Press Ctrl+C to stop it."
Write-Host ""

Push-Location $backendDir
try {
    & npm start
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        Write-Host ""
        Write-Host "KAAMSETU stopped with exit code $exitCode. Review the error output above." -ForegroundColor Red
    }
} finally {
    Pop-Location
}
