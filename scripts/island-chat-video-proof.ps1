param(
  [string]$OutputDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-06-island-chat-video-proof",
  [string]$VideoText = "https://www.bilibili.com/video/BV15YPyzVEBF/?share_source=copy_web&vd_source=9e54d1e3357f8910b2ab8cbda98b1610"
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
}
"@
Add-Type -TypeDefinition $signature

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

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
    Right = $rect.Right
    Bottom = $rect.Bottom
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
  param(
    [int]$X,
    [int]$Y,
    [int]$WaitMs = 240
  )
  [IslandNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds $WaitMs
}

function Send-Key {
  param([int]$VirtualKey)
  $proc = Get-IslandProcess
  Activate-Island
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0100, [IntPtr]$VirtualKey, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 60
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0101, [IntPtr]$VirtualKey, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 220
}

function Get-ClientPoint {
  param(
    [int]$ClientX,
    [int]$ClientY
  )
  $rect = Get-IslandRect
  return @{
    ClientX = $ClientX
    ClientY = $ClientY
    X = [int]($rect.Left + $ClientX)
    Y = [int]($rect.Top + $ClientY)
  }
}

function Send-MouseWheel {
  param(
    [hashtable]$Point,
    [int]$Delta
  )
  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  $wParam = [IntPtr](($Delta -shl 16))
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x020A, $wParam, $lParam) | Out-Null
  Start-Sleep -Milliseconds 260
}

function Left-ClickPoint {
  param([hashtable]$Point)
  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0200, [IntPtr]::Zero, $lParam) | Out-Null
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0201, [IntPtr]1, $lParam) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0202, [IntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 240
}

function Get-OutputCenterPoint {
  $rect = Get-IslandRect
  return Get-ClientPoint -ClientX ([int]($rect.Width / 2)) -ClientY ([int]([Math]::Min($rect.Height - 46, 118)))
}

function Get-VideoDownloadPoint {
  $rect = Get-IslandRect
  $pillWidth = 292
  $pillHeight = 64
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  $btnCenterX = $pillLeft + $pillWidth - 32
  $btnCenterY = $pillTop + [int]($pillHeight / 2)
  return Get-ClientPoint -ClientX $btnCenterX -ClientY $btnCenterY
}

function Wait-NewMp4 {
  param(
    [datetime]$After,
    [int]$TimeoutSeconds = 18
  )

  $downloadDir = Join-Path $env:USERPROFILE "Downloads"
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $candidate = Get-ChildItem -Path $downloadDir -Filter *.mp4 -ErrorAction SilentlyContinue |
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

$longInput = @"
Plan the migration in five concrete phases.
Include rollback points, dependency risks, rollout strategy, observability checks, and a final acceptance checklist.
Keep the answer actionable and structured for engineering execution.
"@

$longOutput = @"
Phase 1 establishes the baseline and freezes risky changes. Capture current metrics, error rates, and throughput before touching the workflow. Define a rollback line and validate that the current pipeline can be restored within minutes.

Phase 2 moves interface contracts first. Keep old and new payload shapes compatible, ship adapters, and add runtime assertions so invalid data is caught before it reaches users. Instrument success, latency, and failure buckets separately.

Phase 3 migrates execution behind a flag. Route a narrow internal slice first, compare outputs, and keep automated diffing enabled. If confidence drops, disable the flag and return traffic to the known-good path immediately.

Phase 4 expands traffic gradually. Grow by fixed cohorts, review logs every step, and avoid combining unrelated releases. The goal is controlled confidence rather than speed.

Phase 5 removes compatibility shims only after the new path has survived production load, replay tests, and manual acceptance. Archive evidence, keep post-mortem notes, and make the rollback instructions discoverable for the next release.
"@

$startedAt = Get-Date
$shots = @{}

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 500
Send-IslandCommand @{ type = "expand" }
Start-Sleep -Milliseconds 700
Send-IslandCommand @{ type = "clipboard_cut" }
Start-Sleep -Milliseconds 500
Set-ClipboardText -Value $longInput
Send-IslandCommand @{ type = "clipboard_paste" }
Start-Sleep -Milliseconds 900
$shots.longInput = Capture-Island -Name "01-long-input-expanded.png"

Send-IslandCommand @{
  type = "ai_update"
  state = "streaming"
  snippet = $longOutput.Substring(0, [Math]::Min(420, $longOutput.Length))
}
Start-Sleep -Milliseconds 800
$shots.longOutputStreaming = Capture-Island -Name "02-long-output-streaming.png"

Send-IslandCommand @{
  type = "ai_update"
  state = "complete"
  snippet = $longOutput
}
Start-Sleep -Milliseconds 800
$shots.longOutputComplete = Capture-Island -Name "03-long-output-complete.png"

$outputPoint = Get-OutputCenterPoint
Send-MouseWheel -Point $outputPoint -Delta 120
Start-Sleep -Milliseconds 400
$shots.longOutputScrolled = Capture-Island -Name "04-long-output-scrolled-up.png"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 500
Send-IslandCommand @{ type = "expand" }
Start-Sleep -Milliseconds 700
Send-IslandCommand @{ type = "clipboard_cut" }
Start-Sleep -Milliseconds 500
Set-ClipboardText -Value $VideoText
Send-IslandCommand @{ type = "clipboard_paste" }
Start-Sleep -Milliseconds 900
$shots.videoInput = Capture-Island -Name "05-video-input-pasted.png"

Send-Key -VirtualKey 0x0D
Start-Sleep -Seconds 4
$shots.videoAction = Capture-Island -Name "06-video-action.png"

$downloadPoint = Get-VideoDownloadPoint
Left-ClickPoint -Point $downloadPoint
$downloaded = Wait-NewMp4 -After $startedAt
Start-Sleep -Milliseconds 900
$shots.videoSaved = Capture-Island -Name "07-video-saved.png"

$ffprobeJson = $null
if ($downloaded) {
  try {
    $ffprobeJson = & ffprobe -v error -show_entries format=format_name,duration,size -show_streams -of json $downloaded.FullName
  } catch {
    $ffprobeJson = $null
  }
}

$report = [ordered]@{
  outputDir = $OutputDir
  videoText = $VideoText
  screenshots = $shots
  downloadedVideo = if ($downloaded) {
    [ordered]@{
      path = $downloaded.FullName
      size = $downloaded.Length
      lastWriteTime = $downloaded.LastWriteTime
    }
  } else {
    $null
  }
  ffprobe = $ffprobeJson
}

$reportPath = Join-Path $OutputDir "report.json"
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8

Write-Host "[island-chat-video-proof] done"
Write-Host "[island-chat-video-proof] report=$reportPath"
