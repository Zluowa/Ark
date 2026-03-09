param(
  [string]$OutDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-07-island-iopaint-proof",
  [string]$ImagePath = "D:\Moss\projects\omniagent-new\app\test-screenshots\2026-03-07-iopaint-integration-proof\00-source-watermark.png",
  [string]$Instruction = "remove the watermark cleanly and preserve the original design",
  [int]$ProcessingWaitSec = 8,
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
  return @{ X = $pillLeft + 34; Y = $pillTop + [int]($pillHeight / 2) }
}

function Get-PreviewEditPoint {
  $r = Get-IslandRect
  $previewWidth = 340
  $previewHeight = 340
  $previewLeft = [int](($r.Width - $previewWidth) / 2)
  $previewTop = 40
  return @{ X = $previewLeft + 56; Y = $previewTop + 304 }
}

function Get-PreviewShrinkPoint {
  $r = Get-IslandRect
  $previewWidth = 340
  $previewHeight = 340
  $previewLeft = [int](($r.Width - $previewWidth) / 2)
  $previewTop = 40
  return @{ X = $previewLeft + [int]($previewWidth / 2); Y = $previewTop + $previewHeight - 14 }
}

function Send-IslandCommand([hashtable]$CommandBody) {
  $json = $CommandBody | ConvertTo-Json -Compress
  $client = New-Object System.Net.WebClient
  $client.Headers["Content-Type"] = "application/json; charset=utf-8"
  $client.Encoding = [System.Text.Encoding]::UTF8
  $null = $client.UploadString("http://127.0.0.1:9800", "POST", $json)
}

if (-not (Test-Path $ImagePath)) {
  throw "image path not found: $ImagePath"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

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

Start-Sleep -Seconds $ProcessingWaitSec
Capture-Island (Join-Path $OutDir "02-processing.png")

Start-Sleep -Seconds $ResultWaitSec
Capture-Island (Join-Path $OutDir "03-image-action.png")

$previewPoint = Get-ImageActionPreviewPoint
Click-Relative -X $previewPoint.X -Y $previewPoint.Y
Start-Sleep -Milliseconds 900
Capture-Island (Join-Path $OutDir "04-preview-expanded.png")

$editPoint = Get-PreviewEditPoint
Click-Relative -X $editPoint.X -Y $editPoint.Y
Start-Sleep -Milliseconds 1200
Capture-Island (Join-Path $OutDir "05-preview-opened-studio.png")

$shrinkPoint = Get-PreviewShrinkPoint
Click-Relative -X $shrinkPoint.X -Y $shrinkPoint.Y
Start-Sleep -Milliseconds 900
Capture-Island (Join-Path $OutDir "06-shrunk-back.png")

Write-Host "[island-iopaint-proof] outDir=$OutDir"
