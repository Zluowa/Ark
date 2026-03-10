param(
  [string]$OutputDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-06-island-enhanced-proof",
  [string]$WatermarkImagePath = "D:\Moss\projects\omniagent-new\app\test-screenshots\2026-03-06-enhanced-tools-proof\fixtures\fixture-watermark-bottom-right.png",
  [string]$CleanImagePath = "D:\Moss\projects\omniagent-new\app\test-screenshots\2026-03-06-enhanced-tools-proof\fixtures\fixture-clean-reference.png",
  [string]$TextFilePath = "D:\Moss\projects\omniagent-new\app\test-screenshots\2026-03-06-enhanced-tools-proof\fixtures\fixture-notes.txt"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class IslandNative {
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
  if (-not $proc) {
    throw "omniagent-island process not found"
  }
  return $proc
}

function Get-IslandRect {
  $proc = Get-IslandProcess
  $rect = New-Object IslandNative+RECT
  if (-not [IslandNative]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) {
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
  try {
    [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) | Out-Null
  } catch {
  }
  [IslandNative]::ShowWindow([IntPtr]$proc.MainWindowHandle, 5) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandNative]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 220
}

function Send-IslandCommand {
  param([hashtable]$Payload)
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:9800" -Method Post -ContentType "application/json" -Body $json | Out-Null
}

function Set-ClipboardText {
  param([string]$Value)
  for ($i = 0; $i -lt 12; $i++) {
    try {
      Set-Clipboard -Value $Value
      return
    } catch {
      Start-Sleep -Milliseconds 120
    }
  }
  throw "Set-Clipboard failed after retries"
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
  param([int]$X, [int]$Y, [int]$WaitMs = 240)
  [IslandNative]::SetCursorPos($X, $Y) | Out-Null
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

function Left-ClickPoint {
  param([hashtable]$Point)
  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0200, [IntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 80
  [IslandNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 90
  [IslandNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 260
}

function Send-Key {
  param([int]$VirtualKey)
  $proc = Get-IslandProcess
  Activate-Island
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0100, [IntPtr]$VirtualKey, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 60
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0101, [IntPtr]$VirtualKey, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 240
}

function Get-ImageActionPreviewPoint {
  $rect = Get-IslandRect
  $pillWidth = 240
  $pillHeight = 64
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  return Get-ClientPoint -ClientX ($pillLeft + 34) -ClientY ($pillTop + [int]($pillHeight / 2))
}

function Get-PreviewShrinkPoint {
  $rect = Get-IslandRect
  $previewWidth = 340
  $previewHeight = 340
  $previewLeft = [int](($rect.Width - $previewWidth) / 2)
  $previewTop = 40
  return Get-ClientPoint -ClientX ($previewLeft + [int]($previewWidth / 2)) -ClientY ($previewTop + $previewHeight - 14)
}

function Get-FileActionDownloadPoint {
  $rect = Get-IslandRect
  $pillWidth = 300
  $pillHeight = 64
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  $btnCenterX = $pillLeft + $pillWidth - 32
  $btnCenterY = $pillTop + [int]($pillHeight / 2)
  return Get-ClientPoint -ClientX $btnCenterX -ClientY $btnCenterY
}

function Wait-NewFile {
  param(
    [string]$Extension,
    [datetime]$After,
    [int]$TimeoutSeconds = 18
  )

  $downloadDir = Join-Path $env:USERPROFILE "Downloads"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $candidate = Get-ChildItem -Path $downloadDir -Filter "*.$Extension" -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -gt $After } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1
    if ($candidate) {
      return $candidate
    }
    Start-Sleep -Milliseconds 500
  }
  return $null
}

function Invoke-InputCommand {
  param(
    [string]$Text,
    [int]$WaitMs = 2200
  )
  Send-IslandCommand @{ type = "expand" }
  Start-Sleep -Milliseconds 700
  Send-IslandCommand @{ type = "clipboard_cut" }
  Start-Sleep -Milliseconds 400
  Set-ClipboardText -Value $Text
  Send-IslandCommand @{ type = "clipboard_paste" }
  Start-Sleep -Milliseconds 700
  Send-Key -VirtualKey 0x0D
  Start-Sleep -Milliseconds $WaitMs
}

if (-not (Test-Path $WatermarkImagePath)) { throw "watermark image not found: $WatermarkImagePath" }
if (-not (Test-Path $CleanImagePath)) { throw "clean image not found: $CleanImagePath" }
if (-not (Test-Path $TextFilePath)) { throw "text file not found: $TextFilePath" }

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$port9800 = Get-NetTCPConnection -LocalPort 9800 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $port9800) { throw "9800 is not listening" }

$screens = [ordered]@{}
$startedAt = Get-Date

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 600
$screens.idle = Capture-Island -Name "00-idle.png"

Send-IslandCommand @{
  type = "process_file"
  path = $WatermarkImagePath
  instruction = "remove watermark from bottom-right"
}
Start-Sleep -Seconds 1
$screens.removeWatermarkProcessing = Capture-Island -Name "01-remove-watermark-processing.png"
Start-Sleep -Seconds 4
$screens.removeWatermarkAction = Capture-Island -Name "02-remove-watermark-action.png"
$previewPoint = Get-ImageActionPreviewPoint
Left-ClickPoint -Point $previewPoint
Start-Sleep -Milliseconds 900
$screens.removeWatermarkPreview = Capture-Island -Name "03-remove-watermark-preview.png"
$shrinkPoint = Get-PreviewShrinkPoint
Left-ClickPoint -Point $shrinkPoint
Start-Sleep -Milliseconds 800

Send-IslandCommand @{
  type = "process_file"
  path = $CleanImagePath
  instruction = "upscale this image to 4k hd"
}
Start-Sleep -Seconds 1
$screens.upscaleProcessing = Capture-Island -Name "04-upscale-processing.png"
Start-Sleep -Seconds 4
$screens.upscaleAction = Capture-Island -Name "05-upscale-action.png"

Send-IslandCommand @{
  type = "process_file"
  path = $CleanImagePath
  instruction = "compress image for web"
}
Start-Sleep -Seconds 1
$screens.imageCompressProcessing = Capture-Island -Name "06-image-compress-processing.png"
Start-Sleep -Seconds 4
$screens.imageCompressAction = Capture-Island -Name "07-image-compress-action.png"

Send-IslandCommand @{
  type = "process_file"
  path = $TextFilePath
  instruction = "compress this file into zip archive"
}
Start-Sleep -Seconds 1
$screens.fileCompressProcessing = Capture-Island -Name "08-file-compress-processing.png"
Start-Sleep -Seconds 4
$screens.fileCompressAction = Capture-Island -Name "09-file-compress-action.png"

$fileDownloadPoint = Get-FileActionDownloadPoint
Left-ClickPoint -Point $fileDownloadPoint
$downloadedZip = Wait-NewFile -Extension "zip" -After $startedAt -TimeoutSeconds 30
Start-Sleep -Milliseconds 900
$screens.fileCompressSaved = Capture-Island -Name "10-file-compress-saved.png"

Invoke-InputCommand -Text "/music Taylor Swift" -WaitMs 4200
$screens.musicSearch = Capture-Island -Name "11-music-search-result.png"

Invoke-InputCommand -Text "next" -WaitMs 1800
$screens.musicNext = Capture-Island -Name "12-music-after-next.png"

Invoke-InputCommand -Text "pause" -WaitMs 1400
$screens.musicPause = Capture-Island -Name "13-music-paused.png"

Invoke-InputCommand -Text "resume" -WaitMs 1400
$screens.musicResume = Capture-Island -Name "14-music-resumed.png"

$report = [ordered]@{
  outputDir = $OutputDir
  watermarkImagePath = $WatermarkImagePath
  cleanImagePath = $CleanImagePath
  textFilePath = $TextFilePath
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
  throw "File compression download did not produce a zip file."
}

Write-Host "[island-enhanced-proof] done"
Write-Host "[island-enhanced-proof] report=$reportPath"


