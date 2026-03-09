param(
  [string]$OutputDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-09-island-netease-stack-round",
  [string]$SearchQuery = "Adele"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class IslandNeteaseNative {
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

$ReportPath = Join-Path $OutputDir "report.json"
$ReadmePath = Join-Path $OutputDir "README.txt"
$DebugPath = Join-Path $OutputDir "_state.json"

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
  $rect = New-Object IslandNeteaseNative+RECT
  if (-not [IslandNeteaseNative]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) {
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
  [IslandNeteaseNative]::ShowWindow([IntPtr]$proc.MainWindowHandle, 5) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandNeteaseNative]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 220
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
  Start-Sleep -Milliseconds 220
  if (-not (Test-Path $FilePath)) {
    return $null
  }
  try {
    return Get-Content -Raw -Encoding utf8 $FilePath | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Wait-ForIslandState {
  param(
    [string[]]$States,
    [int]$TimeoutSeconds,
    [string]$DebugFile
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $state = Get-IslandDebugState -FilePath $DebugFile
    if ($null -ne $state -and $States -contains [string]$state.pill_state) {
      return $state
    }
    Start-Sleep -Milliseconds 350
  } while ((Get-Date) -lt $deadline)

  $finalState = Get-IslandDebugState -FilePath $DebugFile
  $actual = if ($null -eq $finalState) { "unknown" } else { [string]$finalState.pill_state }
  throw "Timed out waiting for state [$($States -join ', ')]. Last state: $actual"
}

function Capture-Island {
  param([string]$Name)
  Activate-Island
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
  [IslandNeteaseNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds $WaitMs
}

function Left-ClickPoint {
  param([hashtable]$Point)
  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandNeteaseNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0200, [IntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 60
  [IslandNeteaseNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [IslandNeteaseNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 260
}

function Get-StackMusicTilePoint {
  $rect = Get-IslandRect
  $pillWidth = 360
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  $panelLeft = $pillLeft + 16
  $tileGap = 10
  $tileWidth = [int]((($pillWidth - 32) - $tileGap) / 2)
  $row1Top = $pillTop + 136
  return Get-ClientPoint -ClientX ($panelLeft + [int]($tileWidth / 2)) -ClientY ($row1Top + 30)
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

function Get-MusicCompactCenter {
  $rect = Get-IslandRect
  $pillWidth = 240
  $pillHeight = 36
  $pillLeft = [int](($rect.Width - $pillWidth) / 2)
  $pillTop = 40
  return Get-ClientPoint -ClientX ($pillLeft + [int]($pillWidth / 2)) -ClientY ($pillTop + [int]($pillHeight / 2))
}

function Get-OutsideCollapsePoint {
  return Get-ClientPoint -ClientX 28 -ClientY 120
}

function Verify-NeteaseApi {
  $search = Invoke-RestMethod "http://127.0.0.1:3010/api/music/search?q=$([uri]::EscapeDataString($SearchQuery))&limit=3"
  if (-not $search.songs -or $search.songs.Count -lt 1) {
    throw "NetEase search returned no songs"
  }
  $song = $search.songs[0]
  if (-not $song.stream_url) {
    throw "NetEase search result did not include stream_url"
  }
  $audioProbe = & curl.exe -L -s -o NUL -w "%{http_code}|%{content_type}" "$($song.stream_url)"
  if (-not $audioProbe) {
    throw "NetEase audio proxy probe returned no output"
  }
  $parts = $audioProbe.Trim() -split "\|", 2
  $statusCode = if ($parts.Count -ge 1) { [int]$parts[0] } else { 0 }
  $contentType = if ($parts.Count -ge 2) { $parts[1] } else { "" }
  if ($statusCode -ne 200) {
    throw "NetEase audio proxy returned status $statusCode"
  }
  [pscustomobject]@{
    query = $SearchQuery
    firstSong = $song
    audioStatus = $statusCode
    audioContentType = $contentType
  }
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

$apiCheck = Verify-NeteaseApi

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 600
Send-IslandCommand @{ type = "open_stack" }
$stackState = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugFile $DebugPath
$stackShot = Capture-Island -Name "01-stack-netease-entry.png"

Left-ClickPoint -Point (Get-StackMusicTilePoint)
$searchState = Wait-ForIslandState -States @("music_search") -TimeoutSeconds 12 -DebugFile $DebugPath
$searchShot = Capture-Island -Name "02-netease-search.png"

Send-IslandCommand @{ type = "music_search_set_query"; query = $SearchQuery }
Start-Sleep -Milliseconds 220
Send-IslandCommand @{ type = "music_search_submit" }
$resultsState = Wait-ForIslandState -States @("music_results") -TimeoutSeconds 30 -DebugFile $DebugPath
Start-Sleep -Milliseconds 1200
$resultsShot = Capture-Island -Name "03-netease-results.png"

Left-ClickPoint -Point (Get-MusicResultPoint -Index 0)
$expandState = Wait-ForIslandState -States @("music_expand") -TimeoutSeconds 15 -DebugFile $DebugPath
Start-Sleep -Milliseconds 400
$expandShot = Capture-Island -Name "04-netease-expand.png"

Left-ClickPoint -Point (Get-OutsideCollapsePoint)
$waveState = Wait-ForIslandState -States @("music_wave", "music_lyric") -TimeoutSeconds 20 -DebugFile $DebugPath
Start-Sleep -Milliseconds 900
$waveShot = Capture-Island -Name "05-netease-wave.png"

Send-IslandCommand @{ type = "open_stack" }
$reopenStackState = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugFile $DebugPath
Left-ClickPoint -Point (Get-StackMusicTilePoint)
$reopenExpandState = Wait-ForIslandState -States @("music_expand") -TimeoutSeconds 12 -DebugFile $DebugPath

$report = [ordered]@{
  generatedAt = (Get-Date).ToString("s")
  outputDir = $OutputDir
  searchQuery = $SearchQuery
  apiCheck = $apiCheck
  states = [ordered]@{
    stack = $stackState
    search = $searchState
    results = $resultsState
    expand = $expandState
    wave = $waveState
    reopenStack = $reopenStackState
    reopenExpand = $reopenExpandState
  }
  screenshots = [ordered]@{
    stack = [System.IO.Path]::GetFileName($stackShot)
    search = [System.IO.Path]::GetFileName($searchShot)
    results = [System.IO.Path]::GetFileName($resultsShot)
    expand = [System.IO.Path]::GetFileName($expandShot)
    wave = [System.IO.Path]::GetFileName($waveShot)
  }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $ReportPath -Encoding utf8

$readme = @"
NetEase stack proof round

Generated: $((Get-Date).ToString("s"))
Query: $SearchQuery

Shots:
- 01-stack-netease-entry.png: stack shows the NetEase entry
- 02-netease-search.png: tapping the NetEase tile opens music search
- 03-netease-results.png: NetEase-backed search results are returned
- 04-netease-expand.png: selecting a result enters the native playback surface
- 05-netease-wave.png: collapsing returns to the compact active music state
- report.json also records the reopen check: returning to stack and tapping NetEase again lands on music_expand

API verification:
- /api/music/search returned at least one playable NetEase result with a resolved stream_url
- the resolved NetEase stream returned status $($apiCheck.audioStatus) with content type $($apiCheck.audioContentType)
"@
$readme | Set-Content -Path $ReadmePath -Encoding utf8

Write-Host "[island-netease-stack-proof] outDir=$OutputDir"
Write-Host "[island-netease-stack-proof] report=$ReportPath"
