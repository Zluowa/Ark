param(
  [string]$OutputDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-06-island-batch-watermark-proof",
  [string]$WatermarkImagePath = "D:\Moss\projects\omniagent-new\app\test-screenshots\2026-03-06-enhanced-tools-proof\fixtures\fixture-watermark-bottom-right.png",
  [string]$WatermarkImageTopLeftPath = "D:\Moss\projects\omniagent-new\app\test-screenshots\2026-03-06-enhanced-tools-proof\fixtures\fixture-watermark-top-left.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class IslandBatchNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
Add-Type -TypeDefinition $signature

function Get-IslandProcess {
  $proc = Get-Process -Name "omniagent-island" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
  if (-not $proc) { throw "omniagent-island process not found" }
  return $proc
}

function Get-IslandRect {
  $proc = Get-IslandProcess
  $rect = New-Object IslandBatchNative+RECT
  if (-not [IslandBatchNative]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) {
    throw "GetWindowRect failed"
  }
  return [pscustomobject]@{
    Process = $proc
    Left = $rect.Left
    Top = $rect.Top
    Width = $rect.Right - $rect.Left
    Height = $rect.Bottom - $rect.Top
  }
}

function Activate-Island {
  $proc = Get-IslandProcess
  [IslandBatchNative]::ShowWindow([IntPtr]$proc.MainWindowHandle, 5) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandBatchNative]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 220
}

function Send-IslandCommand {
  param([hashtable]$Payload)
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:9800" -Method Post -ContentType "application/json" -Body $json | Out-Null
}

function Capture-Island {
  param([string]$Name)
  $rect = Get-IslandRect
  $path = Join-Path $OutputDir $Name
  $bmp = New-Object System.Drawing.Bitmap($rect.Width, $rect.Height)
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $gfx.Dispose()
  $bmp.Dispose()
  return $path
}

function Move-CursorToPoint {
  param([int]$X, [int]$Y, [int]$WaitMs = 220)
  [IslandBatchNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds $WaitMs
}

function Get-ClientPoint {
  param([int]$ClientX, [int]$ClientY)
  $rect = Get-IslandRect
  return @{
    ClientX = $ClientX
    ClientY = $ClientY
    X = [int]($rect.Left + $ClientX)
    Y = [int]($rect.Top + $ClientY)
  }
}

function Get-FileActionDownloadPoint {
  $rect = Get-IslandRect
  $pillWidth = 300
  $pillHeight = 64
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  $btnCenterX = $pillLeft + 272
  $btnCenterY = $pillTop + [int]($pillHeight / 2)
  return Get-ClientPoint -ClientX $btnCenterX -ClientY $btnCenterY
}

function Left-ClickPoint {
  param([hashtable]$Point)
  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  Activate-Island
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandBatchNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0200, [IntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 80
  [IslandBatchNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 90
  [IslandBatchNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 260
}

function Wait-NewFile {
  param(
    [string]$Extension,
    [datetime]$After,
    [int]$TimeoutSeconds = 30
  )

  $downloadDir = Join-Path $env:USERPROFILE "Downloads"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $candidate = Get-ChildItem -Path $downloadDir -Filter "*.$Extension" -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -gt $After } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate) { return $candidate }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

if (-not (Test-Path $WatermarkImagePath)) { throw "watermark image not found: $WatermarkImagePath" }
if (-not (Test-Path $WatermarkImageTopLeftPath)) { throw "watermark image not found: $WatermarkImageTopLeftPath" }
if (-not (Get-NetTCPConnection -LocalPort 9800 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1)) {
  throw "9800 is not listening"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$screens = [ordered]@{}
Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
$screens.idle = Capture-Island -Name "00-idle.png"

Send-IslandCommand @{
  type = "process_files"
  paths = @($WatermarkImagePath, $WatermarkImageTopLeftPath)
  instruction = "batch remove watermark"
}
Start-Sleep -Seconds 1
$screens.processing = Capture-Island -Name "01-batch-processing.png"
Start-Sleep -Seconds 6
$screens.action = Capture-Island -Name "02-batch-action.png"

$downloadPoint = Get-FileActionDownloadPoint
$downloadStartedAt = Get-Date
Left-ClickPoint -Point $downloadPoint
$downloadedZip = Wait-NewFile -Extension "zip" -After $downloadStartedAt -TimeoutSeconds 30
Start-Sleep -Milliseconds 900
$screens.saved = Capture-Island -Name "03-batch-saved.png"

$report = [ordered]@{
  outputDir = $OutputDir
  watermarkImagePath = $WatermarkImagePath
  watermarkImageTopLeftPath = $WatermarkImageTopLeftPath
  screenshots = $screens
  downloadedZip = if ($downloadedZip) {
    [ordered]@{
      path = $downloadedZip.FullName
      size = $downloadedZip.Length
      lastWriteTime = $downloadedZip.LastWriteTime
    }
  } else {
    $null
  }
}

$reportPath = Join-Path $OutputDir "00-report.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

if (-not $downloadedZip) {
  throw "Batch watermark download did not produce a zip file."
}

Write-Host "[island-batch-watermark-proof] done"
Write-Host "[island-batch-watermark-proof] report=$reportPath"
