param(
  [string]$OutDir = "D:\\Moss\\projects\\omniagent-new\\desktop\\test-screenshots\\2026-03-06-runtime-proof",
  [string]$ImagePath = "D:\\Moss\\projects\\omniagent-new\\app\\test-fixtures\\window-upload-proof\\sample.png",
  [string]$Instruction = "img2img keep the same subject and generate a compact dynamic-island style variation",
  [int]$ProcessingWaitSec = 4,
  [int]$ResultWaitSec = 90
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public static class User32 {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004

function Get-IslandRect {
  $proc = Get-Process -Name "omniagent-island" -ErrorAction Stop | Sort-Object StartTime -Descending | Select-Object -First 1
  if ($proc.MainWindowHandle -eq 0) {
    throw "omniagent-island main window handle is 0"
  }
  $rect = New-Object RECT
  $ok = [User32]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)
  if (-not $ok) { throw "GetWindowRect failed" }
  return @{ Left=$rect.Left; Top=$rect.Top; Width=($rect.Right-$rect.Left); Height=($rect.Bottom-$rect.Top) }
}

function Capture-Island([string]$FilePath) {
  $r = Get-IslandRect
  $bmp = New-Object System.Drawing.Bitmap($r.Width, $r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($FilePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Click-Relative([int]$X, [int]$Y) {
  $r = Get-IslandRect
  $sx = $r.Left + $X
  $sy = $r.Top + $Y
  [User32]::SetCursorPos($sx, $sy) | Out-Null
  Start-Sleep -Milliseconds 60
  [User32]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [User32]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Get-ImageActionPreviewPoint {
  $r = Get-IslandRect
  $pillWidth = 240
  $pillHeight = 64
  $pillLeft = [int](($r.Width - $pillWidth) / 2)
  $pillTop = 40
  return @{
    X = $pillLeft + 34
    Y = $pillTop + [int]($pillHeight / 2)
  }
}

function Send-IslandCommand([hashtable]$CommandBody) {
  $json = $CommandBody | ConvertTo-Json -Compress
  $client = New-Object System.Net.WebClient
  $client.Headers["Content-Type"] = "application/json; charset=utf-8"
  $client.Encoding = [System.Text.Encoding]::UTF8
  $null = $client.UploadString("http://127.0.0.1:9800", "POST", $json)
}

function Get-IslandDebugState([string]$FilePath) {
  if (Test-Path $FilePath) {
    Remove-Item $FilePath -Force
  }
  Send-IslandCommand @{ type = "write_debug_state"; path = $FilePath }
  Start-Sleep -Milliseconds 160
  if (-not (Test-Path $FilePath)) {
    throw "debug state file was not created: $FilePath"
  }
  return Get-Content $FilePath -Raw | ConvertFrom-Json
}

function Wait-ForIslandState([string[]]$States, [int]$TimeoutSeconds, [string]$DebugPath) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $state = Get-IslandDebugState -FilePath $DebugPath
    if ($null -ne $state -and $States -contains [string]$state.pill_state) {
      return $state
    }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)

  $finalState = Get-IslandDebugState -FilePath $DebugPath
  $actual = if ($null -eq $finalState) { "unknown" } else { [string]$finalState.pill_state }
  throw "Timed out waiting for state [$($States -join ', ')]. Last state: $actual"
}

if (-not (Test-Path $ImagePath)) {
  throw "image path not found: $ImagePath"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
Get-ChildItem -Path $OutDir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
$debugPath = Join-Path $OutDir "_runtime-state.json"

$port9800 = Get-NetTCPConnection -LocalPort 9800 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $port9800) { throw "9800 is not listening" }

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Capture-Island (Join-Path $OutDir "00-idle.png")

Send-IslandCommand @{
  type = "process_file"
  path = $ImagePath
  instruction = $Instruction
}

Start-Sleep -Seconds 1
Capture-Island (Join-Path $OutDir "01-upload-triggered.png")

$null = Wait-ForIslandState -States @("image_processing") -TimeoutSeconds $ProcessingWaitSec -DebugPath $debugPath
Capture-Island (Join-Path $OutDir "02-processing.png")

$resultState = Wait-ForIslandState -States @("image_action", "image_preview") -TimeoutSeconds $ResultWaitSec -DebugPath $debugPath
Capture-Island (Join-Path $OutDir "03-image-action-or-result.png")

if ([string]$resultState.pill_state -ne "image_preview") {
  $previewPoint = Get-ImageActionPreviewPoint
  Click-Relative -X $previewPoint.X -Y $previewPoint.Y
}
$null = Wait-ForIslandState -States @("image_preview") -TimeoutSeconds 12 -DebugPath $debugPath
Capture-Island (Join-Path $OutDir "04-preview-expanded.png")

Click-Relative -X 220 -Y 200
Start-Sleep -Milliseconds 900
Capture-Island (Join-Path $OutDir "05-preview-still-expanded-after-inner-click.png")

Click-Relative -X 8 -Y 8
$collapsedState = Wait-ForIslandState -States @("idle") -TimeoutSeconds 8 -DebugPath $debugPath
$collapsedState = Get-IslandDebugState -FilePath $debugPath
$collapsedState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "06-outside-click-collapsed-state.json") -Encoding utf8
Capture-Island (Join-Path $OutDir "06-outside-click-collapsed.png")

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Capture-Island (Join-Path $OutDir "07-back-to-base.png")

Click-Relative -X 220 -Y 58
Start-Sleep -Milliseconds 700
Capture-Island (Join-Path $OutDir "08-input-opened.png")

Click-Relative -X 380 -Y 60
Start-Sleep -Milliseconds 900
Capture-Island (Join-Path $OutDir "09-tool-panel-last-result.png")

Write-Host "[runtime-proof] done"
Write-Host "[runtime-proof] outDir=$OutDir"
Get-ChildItem -Path $OutDir -Filter *.png | Sort-Object Name | Select-Object FullName, Length
