# Run the KAAMSETU backend automated tests from the correct folder.
$ErrorActionPreference = "Stop"
$backendDir = Join-Path $PSScriptRoot "kaamsetu-backend"
if (-not (Test-Path (Join-Path $backendDir "package.json"))) {
    Write-Host "ERROR: Backend package.json was not found at $backendDir" -ForegroundColor Red
    exit 1
}
Push-Location $backendDir
try {
    & npm test
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
