param(
  [string]$OutputDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-07-island-music-polish-proof",
  [string]$BootstrapQuery = "/music Adele Hello",
  [string]$SearchQuery = "Adele",
  [string]$RegressionImagePath = "D:\Moss\projects\omniagent-new\app\test-screenshots\2026-03-06-enhanced-tools-proof\fixtures\fixture-clean-reference.png"
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

function Move-CursorToPoint {
  param([int]$X, [int]$Y, [int]$WaitMs = 200)
  [IslandNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds $WaitMs
}

function Left-ClickPoint {
  param([hashtable]$Point)
  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0200, [IntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 80
  [IslandNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
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

function Send-Text {
  param([string]$Text)
  $proc = Get-IslandProcess
  Activate-Island
  foreach ($ch in $Text.ToCharArray()) {
    [IslandNative]::PostMessage(
      [IntPtr]$proc.MainWindowHandle,
      0x0102,
      [IntPtr][int][char]$ch,
      [IntPtr]::Zero
    ) | Out-Null
    Start-Sleep -Milliseconds 35
  }
  Start-Sleep -Milliseconds 220
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

function Invoke-InputCommand {
  param(
    [string]$Text,
    [int]$WaitMs = 2200
  )
  Send-IslandCommand @{ type = "expand" }
  Start-Sleep -Milliseconds 700
  Send-IslandCommand @{ type = "clipboard_cut" }
  Start-Sleep -Milliseconds 300
  Set-ClipboardText -Value $Text
  Send-IslandCommand @{ type = "clipboard_paste" }
  Start-Sleep -Milliseconds 600
  Send-Key -VirtualKey 0x0D
  Start-Sleep -Milliseconds $WaitMs
}

function Get-MusicCompactCenter {
  $rect = Get-IslandRect
  $pillWidth = 240
  $pillHeight = 36
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  return Get-ClientPoint -ClientX ($pillLeft + [int]($pillWidth / 2)) -ClientY ($pillTop + [int]($pillHeight / 2))
}

function Get-MusicControlPoint {
  param([ValidateSet("prev","play","next","search")] [string]$Target)
  $rect = Get-IslandRect
  $pillWidth = 360
  $pillHeight = 188
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  $centerX = $pillLeft + [int]($pillWidth / 2)
  $controlY = $pillTop + 136
  switch ($Target) {
    "prev" { return Get-ClientPoint -ClientX ($centerX - 40) -ClientY $controlY }
    "play" { return Get-ClientPoint -ClientX $centerX -ClientY $controlY }
    "next" { return Get-ClientPoint -ClientX ($centerX + 40) -ClientY $controlY }
    "search" { return Get-ClientPoint -ClientX ($pillLeft + 320) -ClientY ($pillTop + 36) }
  }
}

function Get-MusicResultPoint {
  param([int]$Index = 0)
  $rect = Get-IslandRect
  $pillWidth = 360
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  $pad = 20
  $rowHeight = 52
  $gap = 6
  $rowY = $pillTop + 36 + ($Index * ($rowHeight + $gap)) + [int]($rowHeight / 2)
  return Get-ClientPoint -ClientX ($pillLeft + $pad + 160) -ClientY $rowY
}

function Get-OutsideCollapsePoint {
  return Get-ClientPoint -ClientX 28 -ClientY 120
}

function Prepare-RegressionImage {
  if (-not (Test-Path $RegressionImagePath)) {
    throw "Regression image not found: $RegressionImagePath"
  }
  Send-IslandCommand @{ type = "prepare_file_ready"; path = $RegressionImagePath }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$debugPath = Join-Path $OutputDir "_state.json"
$screens = [ordered]@{}

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700
$screens.idle = Capture-Island -Name "01-island-music-idle.png"

Invoke-InputCommand -Text $BootstrapQuery -WaitMs 80
$null = Wait-ForIslandState -States @("music_results") -TimeoutSeconds 30 -DebugPath $debugPath
Left-ClickPoint -Point (Get-MusicResultPoint -Index 0)
$null = Wait-ForIslandState -States @("music_expand") -TimeoutSeconds 20 -DebugPath $debugPath
Start-Sleep -Milliseconds 320

Left-ClickPoint -Point (Get-MusicControlPoint -Target "search")
$null = Wait-ForIslandState -States @("music_search") -TimeoutSeconds 12 -DebugPath $debugPath
Send-IslandCommand @{ type = "clipboard_cut" }
Start-Sleep -Milliseconds 300
$screens.searchInput = Capture-Island -Name "02-island-music-search-input.png"

Send-IslandCommand @{ type = "music_search_set_query"; query = $SearchQuery }
Start-Sleep -Milliseconds 240
Send-IslandCommand @{ type = "music_search_submit" }
$null = Wait-ForIslandState -States @("music_results") -TimeoutSeconds 30 -DebugPath $debugPath
Start-Sleep -Milliseconds 1600
$screens.results = Capture-Island -Name "03-island-music-results.png"

Left-ClickPoint -Point (Get-MusicResultPoint -Index 0)
$null = Wait-ForIslandState -States @("music_expand") -TimeoutSeconds 20 -DebugPath $debugPath
Start-Sleep -Milliseconds 360
Left-ClickPoint -Point (Get-OutsideCollapsePoint)
$null = Wait-ForIslandState -States @("music_wave") -TimeoutSeconds 20 -DebugPath $debugPath
Start-Sleep -Milliseconds 900
$screens.wave = Capture-Island -Name "04-island-music-wave.png"

$null = Wait-ForIslandState -States @("music_lyric") -TimeoutSeconds 40 -DebugPath $debugPath
Start-Sleep -Milliseconds 500
$screens.lyric = Capture-Island -Name "05-island-music-lyric.png"

Left-ClickPoint -Point (Get-MusicCompactCenter)
$null = Wait-ForIslandState -States @("music_expand") -TimeoutSeconds 12 -DebugPath $debugPath
Start-Sleep -Milliseconds 400
$screens.expand = Capture-Island -Name "06-island-music-expand.png"

Left-ClickPoint -Point (Get-MusicControlPoint -Target "next")
Start-Sleep -Milliseconds 1100
$null = Wait-ForIslandState -States @("music_expand") -TimeoutSeconds 12 -DebugPath $debugPath
$screens.next = Capture-Island -Name "07-island-music-next.png"

Left-ClickPoint -Point (Get-MusicControlPoint -Target "play")
Start-Sleep -Milliseconds 900
$screens.pause = Capture-Island -Name "08-island-music-paused.png"

Left-ClickPoint -Point (Get-MusicControlPoint -Target "play")
Start-Sleep -Milliseconds 900
$screens.resume = Capture-Island -Name "09-island-music-resumed.png"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 700

Prepare-RegressionImage
$null = Wait-ForIslandState -States @("file_ready") -TimeoutSeconds 12 -DebugPath $debugPath
$screens.regressionImage = Capture-Island -Name "11-regression-image-entry.png"
Send-IslandCommand @{ type = "collapse" }

$report = [ordered]@{
  outputDir = $OutputDir
  bootstrapQuery = $BootstrapQuery
  searchQuery = $SearchQuery
  regressionImagePath = $RegressionImagePath
  generatedAt = (Get-Date).ToString("s")
  screenshots = $screens
  finalState = Get-IslandDebugState -FilePath $debugPath
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutputDir "report.json") -Encoding utf8

Write-Host "[island-music-polish-proof] outDir=$OutputDir"

