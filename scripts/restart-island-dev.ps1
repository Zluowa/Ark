param(
  [switch]$SkipFrontend = $false,
  [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"

function Stop-ProcessByName {
  param([string[]]$Names)
  foreach ($name in $Names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

function Stop-PortListeners {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      try {
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
      } catch {
      }
    }
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$desktopRoot = Join-Path $repoRoot "desktop"
$islandExe = Join-Path $desktopRoot "target/debug/omniagent-island.exe"

Write-Host "[restart] stopping previous island/launcher processes..."
Stop-ProcessByName -Names @("omniagent-island", "island", "omniagent-launcher", "launcher", "omniagent-tauri", "tauri-app")
Stop-PortListeners -Ports @(9800)
if (-not $SkipFrontend) {
  Stop-PortListeners -Ports @(3010)
}
Start-Sleep -Milliseconds 600

if (-not $SkipBuild) {
  Write-Host "[restart] building latest island binary..."
  & cargo build -p omniagent-island --manifest-path (Join-Path $desktopRoot "Cargo.toml")
  if ($LASTEXITCODE -ne 0) {
    throw "cargo build failed"
  }
}

if (-not (Test-Path $islandExe)) {
  throw "island binary not found: $islandExe"
}

$binaryInfo = Get-Item $islandExe
Write-Host "[restart] island binary time: $($binaryInfo.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))"

Write-Host "[restart] starting island..."
Start-Process -FilePath $islandExe -WorkingDirectory $desktopRoot | Out-Null
Start-Sleep -Milliseconds 1000

$islandProc = Get-Process -Name "omniagent-island" -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | Select-Object -First 1
if (-not $islandProc) {
  throw "island process failed to start"
}

if ($islandProc.StartTime -lt $binaryInfo.LastWriteTime.AddSeconds(-2)) {
  throw "island process start time is older than binary build time; stale binary may still be running"
}

if (-not $SkipFrontend) {
  Write-Host "[restart] starting app dev server (3010)..."
  Start-Process -FilePath "powershell" -ArgumentList "-NoProfile", "-Command", "Set-Location '$repoRoot'; pnpm --dir app dev:app" | Out-Null
  Start-Sleep -Seconds 3
}

$listen3010 = Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$listen9800 = Get-NetTCPConnection -LocalPort 9800 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

Write-Host "=== restart summary ==="
Write-Host ("island pid: {0}" -f $islandProc.Id)
Write-Host ("island start: {0}" -f $islandProc.StartTime.ToString("yyyy-MM-dd HH:mm:ss"))
Write-Host ("island port 9800: {0}" -f ($(if ($listen9800) { "ok (pid $($listen9800.OwningProcess))" } else { "not listening" })))
if ($SkipFrontend) {
  Write-Host "frontend: skipped"
} else {
  Write-Host ("frontend port 3010: {0}" -f ($(if ($listen3010) { "ok (pid $($listen3010.OwningProcess))" } else { "not listening" })))
}
