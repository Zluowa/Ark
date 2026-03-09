param(
  [string]$OutDir = "D:\Moss\projects\omniagent-new\review-screenshots\2026-03-08-island-stack-refine-round",
  [string]$PdfPath = "D:\Moss\projects\omniagent-new\app\test-fixtures\window-upload-proof\sample.pdf",
  [string]$ImagePath = "D:\Moss\projects\omniagent-new\app\test-fixtures\window-upload-proof\sample.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class IslandStackNative {
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
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
Add-Type -TypeDefinition $signature

$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004

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

function Activate-Island {
  $proc = Get-IslandProcess
  try {
    [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) | Out-Null
  } catch {
  }
  [IslandStackNative]::ShowWindow([IntPtr]$proc.MainWindowHandle, 5) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandStackNative]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 220
}

function Get-IslandRect {
  $proc = Get-IslandProcess
  $rect = New-Object IslandStackNative+RECT
  if (-not [IslandStackNative]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) {
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

function Send-IslandCommand {
  param([hashtable]$Payload)
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:9800" -Method Post -ContentType "application/json" -Body $json | Out-Null
}

function Get-IslandDebugState([string]$FilePath) {
  if (Test-Path $FilePath) {
    Remove-Item $FilePath -Force -ErrorAction SilentlyContinue
  }
  Send-IslandCommand @{ type = "write_debug_state"; path = $FilePath }
  Start-Sleep -Milliseconds 180
  if (-not (Test-Path $FilePath)) { return $null }
  try {
    return Get-Content -Raw -Encoding utf8 $FilePath | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Wait-ForIslandState([string[]]$States, [int]$TimeoutSeconds, [string]$DebugPath) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $state = Get-IslandDebugState -FilePath $DebugPath
    if ($null -ne $state -and $States -contains [string]$state.pill_state) {
      return $state
    }
    Start-Sleep -Milliseconds 350
  } while ((Get-Date) -lt $deadline)

  $finalState = Get-IslandDebugState -FilePath $DebugPath
  $actual = if ($null -eq $finalState) { "unknown" } else { [string]$finalState.pill_state }
  throw "Timed out waiting for state [$($States -join ', ')]. Last state: $actual"
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
  Activate-Island
  [IslandStackNative]::SetCursorPos($Point.X, $Point.Y) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandStackNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [IslandStackNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 320
}

function Get-StackClientMetrics {
  $rect = Get-IslandRect
  $pillWidth = 312
  $pillHeight = 314
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  $tileWidth = 135
  return @{
    PillLeft = $pillLeft
    PillTop = $pillTop
    PillWidth = $pillWidth
    PillHeight = $pillHeight
    TileWidth = $tileWidth
  }
}

function Get-StackPoint {
  param([ValidateSet("resume","music","files","studio","focus")] [string]$Target)
  $m = Get-StackClientMetrics
  switch ($Target) {
    "resume" {
      return Get-ClientPoint -ClientX ($m.PillLeft + [int]($m.PillWidth / 2)) -ClientY ($m.PillTop + 92)
    }
    "music" {
      return Get-ClientPoint -ClientX ($m.PillLeft + 84) -ClientY ($m.PillTop + 180)
    }
    "files" {
      return Get-ClientPoint -ClientX ($m.PillLeft + 228) -ClientY ($m.PillTop + 180)
    }
    "studio" {
      return Get-ClientPoint -ClientX ($m.PillLeft + 84) -ClientY ($m.PillTop + 250)
    }
    "focus" {
      return Get-ClientPoint -ClientX ($m.PillLeft + 228) -ClientY ($m.PillTop + 250)
    }
  }
}

function Get-CaptureRegion([string]$Mode) {
  $rect = Get-IslandRect
  switch ($Mode) {
    "stack" {
      $width = 390; $height = 376
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 18
    }
    "action" {
      $width = 360; $height = 160
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 24
    }
    "music" {
      $width = 360; $height = 132
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 26
    }
    "edit" {
      $width = 404; $height = 438
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 14
    }
    "focus" {
      $width = 392; $height = 338
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 18
    }
    default {
      $width = $rect.Width
      $height = $rect.Height
      $left = $rect.Left
      $top = $rect.Top
    }
  }
  @{ Left = $left; Top = $top; Width = $width; Height = $height }
}

function Capture-Island {
  param([string]$FilePath, [string]$Mode)
  $r = Get-CaptureRegion -Mode $Mode
  $bmp = New-Object System.Drawing.Bitmap($r.Width, $r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($FilePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

if (-not (Test-Path $PdfPath)) { throw "pdf fixture not found: $PdfPath" }
if (-not (Test-Path $ImagePath)) { throw "image fixture not found: $ImagePath" }

try {
  Send-IslandCommand @{ type = "collapse" }
} catch {
  throw "9800 command endpoint is not reachable"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$debugStatePath = Join-Path $OutDir "_stack_state.json"
$reportPath = Join-Path $OutDir "report.json"
$readmePath = Join-Path $OutDir "README.txt"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 800

Send-IslandCommand @{ type = "process_file"; path = $PdfPath; instruction = "compress this pdf for stack proof" }
$fileAction = Wait-ForIslandState -States @("file_action") -TimeoutSeconds 120 -DebugPath $debugStatePath
if (-not $fileAction.action_requires_download) {
  throw "file action did not expose a downloadable result"
}

Send-IslandCommand @{ type = "open_stack" }
$stackState = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugPath $debugStatePath
Capture-Island -FilePath (Join-Path $OutDir "01-stack-refined.png") -Mode "stack"

Left-ClickPoint (Get-StackPoint -Target "resume")
$resumeState = Wait-ForIslandState -States @("file_action") -TimeoutSeconds 10 -DebugPath $debugStatePath
Capture-Island -FilePath (Join-Path $OutDir "02-stack-resume-file-action.png") -Mode "action"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Send-IslandCommand @{ type = "open_stack" }
$null = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugPath $debugStatePath
Left-ClickPoint (Get-StackPoint -Target "files")
$filesState = Wait-ForIslandState -States @("file_action") -TimeoutSeconds 10 -DebugPath $debugStatePath
Capture-Island -FilePath (Join-Path $OutDir "03-stack-file-entry.png") -Mode "action"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Send-IslandCommand @{ type = "open_stack" }
$null = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugPath $debugStatePath
Left-ClickPoint (Get-StackPoint -Target "music")
$musicState = Wait-ForIslandState -States @("music_search") -TimeoutSeconds 10 -DebugPath $debugStatePath
Capture-Island -FilePath (Join-Path $OutDir "04-stack-music-entry.png") -Mode "music"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Send-IslandCommand @{ type = "prepare_file_ready"; path = $PdfPath }
$null = Wait-ForIslandState -States @("file_ready") -TimeoutSeconds 10 -DebugPath $debugStatePath
Send-IslandCommand @{ type = "open_stack" }
$null = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugPath $debugStatePath
Left-ClickPoint (Get-StackPoint -Target "resume")
$resumeFileReadyState = Wait-ForIslandState -States @("file_ready") -TimeoutSeconds 10 -DebugPath $debugStatePath
Capture-Island -FilePath (Join-Path $OutDir "05-stack-resume-file-ready.png") -Mode "action"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Send-IslandCommand @{ type = "prepare_file_ready"; path = $ImagePath }
$null = Wait-ForIslandState -States @("file_ready") -TimeoutSeconds 10 -DebugPath $debugStatePath
Send-IslandCommand @{ type = "open_stack" }
$null = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugPath $debugStatePath
Left-ClickPoint (Get-StackPoint -Target "studio")
$studioState = Wait-ForIslandState -States @("image_edit") -TimeoutSeconds 10 -DebugPath $debugStatePath
Capture-Island -FilePath (Join-Path $OutDir "06-stack-studio-entry.png") -Mode "edit"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
Send-IslandCommand @{ type = "open_stack" }
$null = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugPath $debugStatePath
Left-ClickPoint (Get-StackPoint -Target "focus")
$focusState = Wait-ForIslandState -States @("focus_setup") -TimeoutSeconds 10 -DebugPath $debugStatePath
Capture-Island -FilePath (Join-Path $OutDir "07-stack-focus-entry.png") -Mode "focus"

$report = @{
  generatedAt = (Get-Date).ToString("s")
  outDir = $OutDir
  fixtures = @{
    pdf = $PdfPath
    image = $ImagePath
  }
  screenshots = @{
    stack = "01-stack-refined.png"
    resumeFileAction = "02-stack-resume-file-action.png"
    files = "03-stack-file-entry.png"
    music = "04-stack-music-entry.png"
    resumeFileReady = "05-stack-resume-file-ready.png"
    studio = "06-stack-studio-entry.png"
    focus = "07-stack-focus-entry.png"
  }
  states = @{
    stack = $stackState
    resumeFileAction = $resumeState
    files = $filesState
    music = $musicState
    resumeFileReady = $resumeFileReadyState
    studio = $studioState
    focus = $focusState
  }
  reviewNotes = @(
    "Header no longer clips with a separate title and subtitle; only the back affordance remains.",
    "Primary resume card reads as the single top action and the four tiles scan as secondary entries.",
    "Files tile reopens file work specifically instead of being hijacked by unrelated live surfaces.",
    "Manual review should still confirm the stack feels quieter than the 2026-03-07 round."
  )
}

$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding utf8
@"
Round: 2026-03-08 island stack refine
Focus:
- simplify the native stack into one primary resume card plus four calm secondary tiles
- remove the old stack title/subtitle clutter and header clipping
- verify resume keeps working for FileAction and pending FileReady
- verify Music, Files, Studio, and Focus tiles open the intended surfaces
Source proof dir:
$OutDir

Screenshots:
- 01-stack-refined.png
- 02-stack-resume-file-action.png
- 03-stack-file-entry.png
- 04-stack-music-entry.png
- 05-stack-resume-file-ready.png
- 06-stack-studio-entry.png
- 07-stack-focus-entry.png
"@ | Set-Content -Path $readmePath -Encoding utf8
Write-Host "[island-stack-proof] outDir=$OutDir"
Write-Host "[island-stack-proof] report=$reportPath"
