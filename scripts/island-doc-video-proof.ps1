param(
  [string]$OutDir = "D:\\Moss\\projects\\omniagent-new\\desktop\\test-screenshots\\2026-03-06-island-doc-video-proof",
  [string]$PdfPath = "D:\\Moss\\projects\\omniagent-new\\app\\test-fixtures\\window-upload-proof\\sample.pdf",
  [string]$DocxPath = "D:\\Moss\\projects\\omniagent-new\\app\\test-fixtures\\window-upload-proof\\sample.docx",
  [string]$MediaUrl = "https://www.bilibili.com/video/BV1m34y1F7fD/"
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
}
"@

function Get-IslandRect {
  $proc = Get-Process -Name "omniagent-island" -ErrorAction Stop | Sort-Object StartTime -Descending | Select-Object -First 1
  if ($proc.MainWindowHandle -eq 0) {
    throw "omniagent-island main window handle is 0"
  }
  $rect = New-Object RECT
  $ok = [User32]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)
  if (-not $ok) { throw "GetWindowRect failed" }
  return @{
    Left = $rect.Left
    Top = $rect.Top
    Width = ($rect.Right - $rect.Left)
    Height = ($rect.Bottom - $rect.Top)
  }
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

function Send-IslandCommand([hashtable]$CommandBody) {
  $json = $CommandBody | ConvertTo-Json -Compress -Depth 8
  $client = New-Object System.Net.WebClient
  $client.Headers["Content-Type"] = "application/json; charset=utf-8"
  $client.Encoding = [System.Text.Encoding]::UTF8
  $null = $client.UploadString("http://127.0.0.1:9800", "POST", $json)
}

function Invoke-Execute([string]$Tool, [hashtable]$Params) {
  $body = @{ tool = $Tool; params = $Params } | ConvertTo-Json -Depth 8
  return Invoke-RestMethod -Uri "http://127.0.0.1:3010/api/v1/execute" -Method Post -ContentType "application/json" -Body $body
}

if (-not (Test-Path $PdfPath)) { throw "pdf path not found: $PdfPath" }
if (-not (Test-Path $DocxPath)) { throw "docx path not found: $DocxPath" }

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$port9800 = Get-NetTCPConnection -LocalPort 9800 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$port3010 = Get-NetTCPConnection -LocalPort 3010 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $port9800) { throw "9800 is not listening" }
if (-not $port3010) { throw "3010 is not listening" }

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Capture-Island (Join-Path $OutDir "00-idle.png")

Send-IslandCommand @{
  type = "process_file"
  path = $PdfPath
  instruction = "compress pdf"
}
Start-Sleep -Milliseconds 900
Capture-Island (Join-Path $OutDir "01-pdf-processing.png")
Start-Sleep -Seconds 4
Capture-Island (Join-Path $OutDir "02-pdf-action.png")

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700

Send-IslandCommand @{
  type = "process_file"
  path = $DocxPath
  instruction = "extract text"
}
Start-Sleep -Milliseconds 900
Capture-Island (Join-Path $OutDir "03-docx-processing.png")
Start-Sleep -Seconds 4
Capture-Island (Join-Path $OutDir "04-docx-action.png")

$videoResponse = Invoke-Execute -Tool "media.download_video" -Params @{ url = $MediaUrl }
$videoResponse | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $OutDir "05-media-download-video-response.json")

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700

Send-IslandCommand @{
  type = "tool_progress"
  name = "media.download_video"
  progress = 0.48
  status = "running"
}
Start-Sleep -Milliseconds 800
Capture-Island (Join-Path $OutDir "06-video-processing.png")

$videoResult = $videoResponse.result
$detailParts = @()
if ($videoResult.platform) { $detailParts += [string]$videoResult.platform }
if ($videoResult.duration_str) { $detailParts += [string]$videoResult.duration_str }
$detailText = ($detailParts -join " • ")

Send-IslandCommand @{
  type = "file_processed"
  label = "media.download_video"
  file_name = "video-download.mp4"
  download_url = [string]$videoResult.output_file_url
  preview_url = [string]$videoResult.thumbnail
  detail_text = $detailText
}
Start-Sleep -Milliseconds 900
Capture-Island (Join-Path $OutDir "07-video-action.png")

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Send-IslandCommand @{
  type = "tool_progress"
  name = "pdf.compress"
  progress = 0.41
  status = "running"
}
Start-Sleep -Milliseconds 800
Capture-Island (Join-Path $OutDir "08-file-processing-forced.png")

$report = @{
  outDir = $OutDir
  pdfPath = $PdfPath
  docxPath = $DocxPath
  mediaUrl = $MediaUrl
  screenshots = @{
    idle = (Join-Path $OutDir "00-idle.png")
    pdfProcessing = (Join-Path $OutDir "01-pdf-processing.png")
    pdfAction = (Join-Path $OutDir "02-pdf-action.png")
    docxProcessing = (Join-Path $OutDir "03-docx-processing.png")
    docxAction = (Join-Path $OutDir "04-docx-action.png")
    videoProcessing = (Join-Path $OutDir "06-video-processing.png")
    videoAction = (Join-Path $OutDir "07-video-action.png")
    fileProcessingForced = (Join-Path $OutDir "08-file-processing-forced.png")
  }
  videoResponse = $videoResponse
}
$report | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 (Join-Path $OutDir "report.json")

Write-Host "[island-doc-video-proof] done"
Write-Host "[island-doc-video-proof] outDir=$OutDir"
