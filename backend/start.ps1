$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$backendPython = Join-Path $PSScriptRoot ".venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $backendPython)) {
    throw "Backend Python missing. Follow backend/README.md to install dependencies first."
}
Push-Location -LiteralPath $projectDirectory
try {
    & $backendPython -X utf8 -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 --no-access-log
    if ($LASTEXITCODE -ne 0) { throw "Backend exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}
