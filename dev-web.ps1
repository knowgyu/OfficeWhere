param(
  [int]$BackendPort = $(if ($env:BACKEND_PORT) { [int]$env:BACKEND_PORT } else { 8765 }),
  [int]$FrontendPort = $(if ($env:FRONTEND_PORT) { [int]$env:FRONTEND_PORT } else { 5173 }),
  [string]$HostAddress = $(if ($env:HOST) { $env:HOST } else { '127.0.0.1' })
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $RootDir 'venv\Scripts\python.exe'
if (Test-Path $VenvPython) {
  $PythonBin = $VenvPython
} else {
  $PythonBin = 'python'
}

$BackendUrl = "http://$HostAddress`:$BackendPort"
Write-Host "[officewhere] backend 시작: $BackendUrl"
$BackendProcess = Start-Process `
  -FilePath $PythonBin `
  -ArgumentList @('backend_server.py', '--host', $HostAddress, '--port', $BackendPort) `
  -WorkingDirectory $RootDir `
  -PassThru `
  -NoNewWindow

try {
  $HealthUrl = "$BackendUrl/health"
  $Ready = $false
  for ($i = 0; $i -lt 80; $i++) {
    try {
      Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 1 | Out-Null
      $Ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 250
    }
  }
  if (-not $Ready) {
    throw "backend health check 실패: $HealthUrl"
  }

  $env:BACKEND_PORT = [string]$BackendPort
  $env:FRONTEND_PORT = [string]$FrontendPort
  $env:VITE_BACKEND_URL = $BackendUrl

  Write-Host "[officewhere] frontend 시작: http://$HostAddress`:$FrontendPort"
  Write-Host '[officewhere] 종료하려면 Ctrl+C 를 누르세요.'
  Push-Location (Join-Path $RootDir 'frontend')
  try {
    & npm.cmd run dev -- --host $HostAddress --port $FrontendPort --strictPort
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
} finally {
  if ($BackendProcess -and -not $BackendProcess.HasExited) {
    Write-Host ''
    Write-Host '[officewhere] backend 종료 중...'
    Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
