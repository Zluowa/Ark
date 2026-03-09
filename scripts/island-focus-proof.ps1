param(
  [string]$OutDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-08-island-focus-polish-round"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class IslandFocusNative {
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
$FocusLabel = "Ship launch brief"
$FocusTotalMs = 25 * 60 * 1000
$BreakTotalMs = 5 * 60 * 1000

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
  [IslandFocusNative]::ShowWindow([IntPtr]$proc.MainWindowHandle, 5) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandFocusNative]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 220
}

function Get-IslandRect {
  $proc = Get-IslandProcess
  $rect = New-Object IslandFocusNative+RECT
  if (-not [IslandFocusNative]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) {
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
  if (-not (Test-Path $FilePath)) {
    return $null
  }
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
    Start-Sleep -Milliseconds 320
  } while ((Get-Date) -lt $deadline)

  $finalState = Get-IslandDebugState -FilePath $DebugPath
  $actual = if ($null -eq $finalState) { "unknown" } else { [string]$finalState.pill_state }
  throw "Timed out waiting for state [$($States -join ', ')]. Last state: $actual"
}

function Save-StateSnapshot([string]$FilePath) {
  $state = Get-IslandDebugState -FilePath $FilePath
  if ($null -ne $state) {
    $state | ConvertTo-Json -Depth 8 | Set-Content -Path $FilePath -Encoding utf8
  }
  return $state
}

function Get-ClientPoint {
  param([int]$ClientX, [int]$ClientY)
  $rect = Get-IslandRect
  return @{
    X = [int]($rect.Left + $ClientX)
    Y = [int]($rect.Top + $ClientY)
  }
}

function Left-ClickPoint {
  param([hashtable]$Point)
  Activate-Island
  [IslandFocusNative]::SetCursorPos($Point.X, $Point.Y) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandFocusNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [IslandFocusNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 360
}

function Get-StackClientMetrics {
  $rect = Get-IslandRect
  $pillWidth = 312
  $pillHeight = 314
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  return @{
    PillLeft = $pillLeft
    PillTop = $pillTop
  }
}

function Get-StackPoint {
  param([ValidateSet("focus")] [string]$Target)
  $m = Get-StackClientMetrics
  switch ($Target) {
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
    "setup" {
      $width = 392; $height = 338
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 18
    }
    "compact" {
      $width = 360; $height = 132
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 22
    }
    "expand" {
      $width = 398; $height = 246
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 18
    }
    "complete" {
      $width = 398; $height = 246
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 18
    }
    "input" {
      $width = 382; $height = 146
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 24
    }
    default {
      $width = $rect.Width
      $height = $rect.Height
      $left = $rect.Left
      $top = $rect.Top
    }
  }
  return @{
    Left = $left
    Top = $top
    Width = $width
    Height = $height
  }
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

try {
  Send-IslandCommand @{ type = "collapse" }
} catch {
  throw "9800 command endpoint is not reachable"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$debugPath = Join-Path $OutDir "_focus_state.json"
$reportPath = Join-Path $OutDir "report.json"
$readmePath = Join-Path $OutDir "README.txt"

$shots = New-Object System.Collections.Generic.List[string]
$states = @{}

Start-Sleep -Milliseconds 700

Send-IslandCommand @{ type = "open_stack" }
$stackState = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugPath $debugPath
$states.stack = $stackState
Start-Sleep -Milliseconds 420
$stackShot = Join-Path $OutDir "01-stack-focus-entry.png"
Capture-Island -FilePath $stackShot -Mode "stack"
$shots.Add([System.IO.Path]::GetFileName($stackShot))

$null = $stackState
Send-IslandCommand @{ type = "open_focus" }
$setupState = Wait-ForIslandState -States @("focus_setup") -TimeoutSeconds 10 -DebugPath $debugPath
$states.setup = $setupState
Start-Sleep -Milliseconds 380
$setupShot = Join-Path $OutDir "02-focus-setup.png"
Capture-Island -FilePath $setupShot -Mode "setup"
$shots.Add([System.IO.Path]::GetFileName($setupShot))

Send-IslandCommand @{ type = "focus_set_label"; text = $FocusLabel }
Send-IslandCommand @{ type = "focus_set_duration"; total_ms = $FocusTotalMs }
Start-Sleep -Milliseconds 280
$filledSetupState = Wait-ForIslandState -States @("focus_setup") -TimeoutSeconds 5 -DebugPath $debugPath
$states.setupFilled = $filledSetupState
Start-Sleep -Milliseconds 220
$setupFilledShot = Join-Path $OutDir "03-focus-setup-filled.png"
Capture-Island -FilePath $setupFilledShot -Mode "setup"
$shots.Add([System.IO.Path]::GetFileName($setupFilledShot))

Send-IslandCommand @{ type = "focus_start" }
$runState = Wait-ForIslandState -States @("focus_run") -TimeoutSeconds 10 -DebugPath $debugPath
$states.run = $runState
Start-Sleep -Milliseconds 320
$runShot = Join-Path $OutDir "04-focus-run-compact.png"
Capture-Island -FilePath $runShot -Mode "compact"
$shots.Add([System.IO.Path]::GetFileName($runShot))

Send-IslandCommand @{ type = "open_focus" }
$expandState = Wait-ForIslandState -States @("focus_expand") -TimeoutSeconds 10 -DebugPath $debugPath
$states.expand = $expandState
Start-Sleep -Milliseconds 360
$expandShot = Join-Path $OutDir "05-focus-expand-running.png"
Capture-Island -FilePath $expandShot -Mode "expand"
$shots.Add([System.IO.Path]::GetFileName($expandShot))

Send-IslandCommand @{ type = "focus_pause" }
Start-Sleep -Milliseconds 250
$pausedState = Wait-ForIslandState -States @("focus_expand") -TimeoutSeconds 5 -DebugPath $debugPath
$states.paused = $pausedState
Start-Sleep -Milliseconds 220
$pausedShot = Join-Path $OutDir "06-focus-expand-paused.png"
Capture-Island -FilePath $pausedShot -Mode "expand"
$shots.Add([System.IO.Path]::GetFileName($pausedShot))

Send-IslandCommand @{ type = "focus_resume" }
Start-Sleep -Milliseconds 250

Send-IslandCommand @{ type = "focus_advance"; elapsed_ms = $FocusTotalMs }
$workCompleteState = Wait-ForIslandState -States @("focus_complete") -TimeoutSeconds 10 -DebugPath $debugPath
$states.workComplete = $workCompleteState
Start-Sleep -Milliseconds 480
$workCompleteShot = Join-Path $OutDir "07-focus-work-complete.png"
Capture-Island -FilePath $workCompleteShot -Mode "complete"
$shots.Add([System.IO.Path]::GetFileName($workCompleteShot))
$workCompleteState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "07-focus-work-complete-state.json") -Encoding utf8

Send-IslandCommand @{ type = "focus_start_break" }
$breakRunState = Wait-ForIslandState -States @("focus_run") -TimeoutSeconds 10 -DebugPath $debugPath
$states.breakRun = $breakRunState
Start-Sleep -Milliseconds 320
$breakRunShot = Join-Path $OutDir "08-focus-break-run.png"
Capture-Island -FilePath $breakRunShot -Mode "compact"
$shots.Add([System.IO.Path]::GetFileName($breakRunShot))

Send-IslandCommand @{ type = "focus_advance"; elapsed_ms = $BreakTotalMs }
$breakCompleteState = Wait-ForIslandState -States @("focus_complete") -TimeoutSeconds 10 -DebugPath $debugPath
$states.breakComplete = $breakCompleteState
Start-Sleep -Milliseconds 480
$breakCompleteShot = Join-Path $OutDir "09-focus-break-complete.png"
Capture-Island -FilePath $breakCompleteShot -Mode "complete"
$shots.Add([System.IO.Path]::GetFileName($breakCompleteShot))
$breakCompleteState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "09-focus-break-complete-state.json") -Encoding utf8

Send-IslandCommand @{ type = "focus_start" }
$secondRunState = Wait-ForIslandState -States @("focus_run") -TimeoutSeconds 10 -DebugPath $debugPath
$states.secondRun = $secondRunState
Send-IslandCommand @{ type = "focus_advance"; elapsed_ms = $FocusTotalMs }
$logReadyState = Wait-ForIslandState -States @("focus_complete") -TimeoutSeconds 10 -DebugPath $debugPath
$states.logReady = $logReadyState

Send-IslandCommand @{ type = "focus_log_progress" }
$inputState = Wait-ForIslandState -States @("input") -TimeoutSeconds 10 -DebugPath $debugPath
$states.logInput = $inputState
Start-Sleep -Milliseconds 320
$inputShot = Join-Path $OutDir "10-focus-log-progress-input.png"
Capture-Island -FilePath $inputShot -Mode "input"
$shots.Add([System.IO.Path]::GetFileName($inputShot))
$inputState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "10-focus-log-progress-state.json") -Encoding utf8

$readme = @(
  "Native island Focus / Pomodoro proof"
  "generated_at=$(Get-Date -Format s)"
  "out_dir=$OutDir"
  ""
  "shots:"
  "01-stack-focus-entry.png - stack view with Focus tile visible"
  "02-focus-setup.png - Focus setup sheet opened from stack"
  "03-focus-setup-filled.png - setup with label and preset applied"
  "04-focus-run-compact.png - compact running timer"
  "05-focus-expand-running.png - expanded running controls"
  "06-focus-expand-paused.png - expanded paused state"
  "07-focus-work-complete.png - work completion with next actions"
  "08-focus-break-run.png - break timer in compact state"
  "09-focus-break-complete.png - break completion state"
  "10-focus-log-progress-input.png - log progress handoff into Input"
) -join [Environment]::NewLine
$readme | Set-Content -Path $readmePath -Encoding utf8

$report = @{
  outDir = $OutDir
  generatedAt = (Get-Date).ToString("s")
  label = $FocusLabel
  shots = $shots
  states = @{
    stack = $states.stack
    setup = $states.setupFilled
    run = $states.run
    paused = $states.paused
    workComplete = $states.workComplete
    breakRun = $states.breakRun
    breakComplete = $states.breakComplete
    logInput = $states.logInput
  }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding utf8

Write-Host "[island-focus-proof] outDir=$OutDir"
