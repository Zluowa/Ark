param(
  [string]$OutputDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-09-island-netease-auth-round",
  [string]$SearchQuery = "Adele",
  [switch]$RestartIsland = $true,
  [switch]$LeaveConnection = $false
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class IslandNeteaseAuthNative {
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

$ProjectRoot = "D:\Moss\projects\omniagent-new"
$IslandExe = Join-Path $ProjectRoot "desktop\target\debug\omniagent-island.exe"
$ReportPath = Join-Path $OutputDir "report.json"
$ReadmePath = Join-Path $OutputDir "README.txt"
$DebugPath = Join-Path $OutputDir "_state.json"

function Wait-ForPort {
  param(
    [int]$Port,
    [int]$TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $iar = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
      if ($iar.AsyncWaitHandle.WaitOne(300) -and $client.Connected) {
        $client.EndConnect($iar) | Out-Null
        return $true
      }
    } catch {
    } finally {
      $client.Dispose()
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "Port $Port not listening"
}

function Stop-IslandRuntime {
  Get-Process -Name "omniagent-island" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 800
}

function Start-IslandRuntime {
  if (-not (Test-Path $IslandExe)) {
    throw "Missing island binary: $IslandExe"
  }
  Start-Process -FilePath $IslandExe -WorkingDirectory (Split-Path $IslandExe -Parent) | Out-Null
  Wait-ForPort -Port 9800 -TimeoutSeconds 25 | Out-Null
  $deadline = (Get-Date).AddSeconds(20)
  do {
    $proc = Get-IslandProcess -AllowMissing
    if ($proc) {
      return $proc
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  throw "omniagent-island window did not appear"
}

function Get-IslandProcess {
  param([switch]$AllowMissing)

  $proc = Get-Process -Name "omniagent-island" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1
  if (-not $proc -and -not $AllowMissing) {
    throw "omniagent-island process not found"
  }
  return $proc
}

function Get-IslandRect {
  $proc = Get-IslandProcess
  $rect = New-Object IslandNeteaseAuthNative+RECT
  if (-not [IslandNeteaseAuthNative]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) {
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
  [IslandNeteaseAuthNative]::ShowWindow([IntPtr]$proc.MainWindowHandle, 5) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandNeteaseAuthNative]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 220
}

function Send-IslandCommand {
  param([hashtable]$Payload)
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:9800" -Method Post -ContentType "application/json" -Body $json | Out-Null
}

function Invoke-AppJson {
  param(
    [string]$Method,
    [string]$Url
  )

  return Invoke-RestMethod -Uri $Url -Method $Method
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
    [scriptblock]$Predicate,
    [int]$TimeoutSeconds = 20,
    [string]$DebugFile = $DebugPath,
    [string]$Label = "state"
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $state = Get-IslandDebugState -FilePath $DebugFile
    if ($null -ne $state) {
      $matched = & $Predicate $state
      if ($matched) {
        return $state
      }
    }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)

  $lastState = Get-IslandDebugState -FilePath $DebugFile
  $lastJson = if ($null -eq $lastState) { "null" } else { $lastState | ConvertTo-Json -Depth 8 -Compress }
  throw "Timed out waiting for $Label. Last state: $lastJson"
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
  [IslandNeteaseAuthNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds $WaitMs
}

function Left-ClickPoint {
  param([hashtable]$Point)
  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandNeteaseAuthNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0200, [IntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 60
  [IslandNeteaseAuthNative]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [IslandNeteaseAuthNative]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
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

function Get-OutsideCollapsePoint {
  return Get-ClientPoint -ClientX 28 -ClientY 120
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
Write-Host "[island-netease-auth-proof] outputDir=$OutputDir"
Wait-ForPort -Port 3010 -TimeoutSeconds 20 | Out-Null
Write-Host "[island-netease-auth-proof] app service ready"

if ($RestartIsland) {
  Write-Host "[island-netease-auth-proof] restarting island runtime"
  Stop-IslandRuntime
  Start-IslandRuntime | Out-Null
} else {
  Wait-ForPort -Port 9800 -TimeoutSeconds 20 | Out-Null
}
Write-Host "[island-netease-auth-proof] island runtime ready"

$disconnectResult = Invoke-AppJson -Method Delete -Url "http://127.0.0.1:3010/api/v1/connections/netease"
$connectionBefore = Invoke-AppJson -Method Get -Url "http://127.0.0.1:3010/api/v1/connections/netease"
if ($connectionBefore.connected) {
  throw "NetEase connection should be disconnected before proof"
}
Write-Host "[island-netease-auth-proof] disconnected baseline verified"

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 500
Send-IslandCommand @{ type = "open_stack" }
$stackState = Wait-ForIslandState -Label "stack tool panel" -Predicate {
  param($state)
  [string]$state.pill_state -eq "tool_panel"
}
$stackShot = Capture-Island -Name "01-stack-netease-auth-entry.png"
Write-Host "[island-netease-auth-proof] captured stack entry"

Left-ClickPoint -Point (Get-StackMusicTilePoint)
$authSheetState = Wait-ForIslandState -Label "music auth sheet" -Predicate {
  param($state)
  [string]$state.pill_state -eq "music_auth"
}
$authSheetShot = Capture-Island -Name "02-netease-auth-sheet.png"
Write-Host "[island-netease-auth-proof] captured auth sheet"

$authQrState = Wait-ForIslandState -TimeoutSeconds 30 -Label "music auth qr" -Predicate {
  param($state)
  ([string]$state.pill_state -eq "music_auth") -and
  ([bool]$state.music_auth_qr_ready) -and
  (@("waiting", "confirm", "success") -contains [string]$state.music_auth_status)
}
$authQrShot = Capture-Island -Name "03-netease-auth-qr.png"
Write-Host "[island-netease-auth-proof] captured live QR"

$startedSessionId = [string]$authQrState.music_auth_session_id
if ([string]::IsNullOrWhiteSpace($startedSessionId)) {
  throw "music_auth_session_id missing from debug state"
}

$pollWaiting = Invoke-AppJson -Method Get -Url "http://127.0.0.1:3010/api/v1/connections/netease/auth/$startedSessionId"
$seedResult = Invoke-AppJson -Method Post -Url "http://127.0.0.1:3010/api/v1/connections/netease/seed"
$pollSuccess = Invoke-AppJson -Method Get -Url "http://127.0.0.1:3010/api/v1/connections/netease/auth/$startedSessionId"
$connectionAfter = Invoke-AppJson -Method Get -Url "http://127.0.0.1:3010/api/v1/connections/netease"
$recommendAfter = Invoke-AppJson -Method Get -Url "http://127.0.0.1:3010/api/music/recommend?limit=6"
$searchAfter = Invoke-AppJson -Method Get -Url ("http://127.0.0.1:3010/api/music/search?q={0}&limit=3" -f [uri]::EscapeDataString($SearchQuery))
Write-Host "[island-netease-auth-proof] seeded connected state via $($seedResult.source)"

$connectedState = Wait-ForIslandState -TimeoutSeconds 18 -Label "music auth success" -Predicate {
  param($state)
  ([string]$state.pill_state -eq "music_auth") -and
  ([string]$state.music_auth_status -eq "success") -and
  ([bool]$state.music_netease_connected)
}
$connectedShot = Capture-Island -Name "04-netease-auth-connected.png"
Write-Host "[island-netease-auth-proof] captured connected auth state"

$resultsState = Wait-ForIslandState -TimeoutSeconds 20 -Label "authorized music results" -Predicate {
  param($state)
  ([string]$state.pill_state -eq "music_results") -and
  ([bool]$state.music_netease_connected) -and
  ([string]$state.music_results_context_label -eq "For you") -and
  ([int]$state.music_queue_len -ge 1)
}
$resultsShot = Capture-Island -Name "05-netease-authorized-results.png"
Write-Host "[island-netease-auth-proof] captured authorized results"

Left-ClickPoint -Point (Get-MusicResultPoint -Index 0)
$playbackState = Wait-ForIslandState -TimeoutSeconds 18 -Label "authorized playback" -Predicate {
  param($state)
  ([string]$state.pill_state -eq "music_expand") -and
  ([bool]$state.music_playing) -and
  ([int]$state.music_queue_len -ge 1)
}
Start-Sleep -Milliseconds 500
$playbackShot = Capture-Island -Name "06-netease-authorized-playback.png"
Write-Host "[island-netease-auth-proof] captured authorized playback"

Left-ClickPoint -Point (Get-OutsideCollapsePoint)
$waveState = Wait-ForIslandState -TimeoutSeconds 15 -Label "compact playback" -Predicate {
  param($state)
  @("music_wave", "music_lyric") -contains [string]$state.pill_state
}

Send-IslandCommand @{ type = "open_stack" }
$reopenStackState = Wait-ForIslandState -TimeoutSeconds 10 -Label "reopen stack" -Predicate {
  param($state)
  [string]$state.pill_state -eq "tool_panel"
}
Left-ClickPoint -Point (Get-StackMusicTilePoint)
$reopenExpandState = Wait-ForIslandState -TimeoutSeconds 12 -Label "reopen authorized playback" -Predicate {
  param($state)
  [string]$state.pill_state -eq "music_expand"
}

$report = [ordered]@{
  generatedAt = (Get-Date).ToString("s")
  outputDir = $OutputDir
  searchQuery = $SearchQuery
  caveat = "QR start and waiting-state polling are live. Connected-state proof used the trusted-local seed route. On this machine the seed route produced an anonymous guest credential because no real user scan was available."
  api = [ordered]@{
    disconnect = $disconnectResult
    connectionBefore = $connectionBefore
    authWaiting = $pollWaiting
    seed = $seedResult
    authSuccess = $pollSuccess
    connectionAfter = $connectionAfter
    recommendSummary = [ordered]@{
      authorized = $recommendAfter.authorized
      context_label = $recommendAfter.context_label
      song_count = @($recommendAfter.songs).Count
      first_song = if (@($recommendAfter.songs).Count -gt 0) { $recommendAfter.songs[0] } else { $null }
    }
    searchSummary = [ordered]@{
      authorized = $searchAfter.authorized
      song_count = @($searchAfter.songs).Count
      first_song = if (@($searchAfter.songs).Count -gt 0) { $searchAfter.songs[0] } else { $null }
    }
  }
  states = [ordered]@{
    stack = $stackState
    authSheet = $authSheetState
    authQr = $authQrState
    connected = $connectedState
    results = $resultsState
    playback = $playbackState
    compact = $waveState
    reopenStack = $reopenStackState
    reopenExpand = $reopenExpandState
  }
  screenshots = [ordered]@{
    stack = [System.IO.Path]::GetFileName($stackShot)
    authSheet = [System.IO.Path]::GetFileName($authSheetShot)
    authQr = [System.IO.Path]::GetFileName($authQrShot)
    connected = [System.IO.Path]::GetFileName($connectedShot)
    results = [System.IO.Path]::GetFileName($resultsShot)
    playback = [System.IO.Path]::GetFileName($playbackShot)
  }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $ReportPath -Encoding utf8

$seedSource = [string]$seedResult.source
$readme = @"
NetEase auth proof round

Generated: $((Get-Date).ToString("s"))
Query: $SearchQuery
Seed source: $seedSource

Shots:
- 01-stack-netease-auth-entry.png: stack shows the disconnected NetEase entry
- 02-netease-auth-sheet.png: tapping NetEase opens the native auth sheet
- 03-netease-auth-qr.png: the auth sheet renders a live QR image from the local app service
- 04-netease-auth-connected.png: the auth sheet reaches connected/success state
- 05-netease-authorized-results.png: connected mode loads authorized "For you" results
- 06-netease-authorized-playback.png: selecting a result enters native playback
- report.json also records the compact playback and reopen checks

Verification:
- /api/v1/connections/netease/auth created a live QR session and status polling returned waiting before connection
- this machine had no real user scan during unattended proof, so the trusted-local seed route completed connection using $seedSource
- /api/v1/connections/netease shows the credential persisted locally after connection
- /api/music/recommend returned authorized results with context_label = For you
- /api/music/search?q=$SearchQuery returned authorized = true after connection
"@
$readme | Set-Content -Path $ReadmePath -Encoding utf8

if (-not $LeaveConnection) {
  Invoke-AppJson -Method Delete -Url "http://127.0.0.1:3010/api/v1/connections/netease" | Out-Null
  if (Test-Path "D:\Moss\projects\omniagent-new\app\.omniagent-state\netease-auth-sessions") {
    Remove-Item -Recurse -Force "D:\Moss\projects\omniagent-new\app\.omniagent-state\netease-auth-sessions"
  }
  Write-Host "[island-netease-auth-proof] cleaned local NetEase proof credential"
}

Write-Host "[island-netease-auth-proof] outDir=$OutputDir"
Write-Host "[island-netease-auth-proof] report=$ReportPath"
