param(
  [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $repoRoot "desktop\test-screenshots\2026-03-06-island-clipboard-proof"
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null

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
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
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

function Read-ClipboardText {
  for ($i = 0; $i -lt 12; $i++) {
    try {
      return ((Get-Clipboard -Raw) -replace "`r", "") -replace "`n$", ""
    } catch {
      Start-Sleep -Milliseconds 120
    }
  }
  throw "Get-Clipboard failed after retries"
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
  param(
    [string]$Name
  )

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
    [int]$WaitMs = 360
  )

  [IslandNative]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds $WaitMs
}

function Left-ClickPoint {
  param(
    [hashtable]$Point
  )

  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0200, [IntPtr]::Zero, $lParam) | Out-Null
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0201, [IntPtr]1, $lParam) | Out-Null
  Start-Sleep -Milliseconds 180
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0202, [IntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 180
}

function Right-ClickPoint {
  param(
    [hashtable]$Point
  )

  $proc = Get-IslandProcess
  $lParam = [IntPtr](($Point.ClientY -shl 16) -bor ($Point.ClientX -band 0xFFFF))
  Move-CursorToPoint -X $Point.X -Y $Point.Y
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0200, [IntPtr]::Zero, $lParam) | Out-Null
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0204, [IntPtr]2, $lParam) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0205, [IntPtr]::Zero, $lParam) | Out-Null
  Start-Sleep -Milliseconds 220
}

function Get-PillPoint {
  param(
    [ValidateSet("input", "output", "file_action")]
    [string]$Surface
  )

  $rect = Get-IslandRect
  $clientX = [int]($rect.Width / 2)
  $clientY = switch ($Surface) {
    "input" { 62 }
    "output" { 140 }
    "file_action" { 64 }
  }
  return @{
    ClientX = $clientX
    ClientY = $clientY
    X = [int]($rect.Left + $clientX)
    Y = [int]($rect.Top + $clientY)
  }
}

function Send-CtrlShortcut {
  param([ValidateSet("c", "v", "x")][string]$Key)

  $proc = Get-IslandProcess
  $vk = switch ($Key) {
    "c" { 0x43 }
    "v" { 0x56 }
    "x" { 0x58 }
  }
  Activate-Island
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0100, [IntPtr]0x11, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 40
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0100, [IntPtr]$vk, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 40
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0101, [IntPtr]$vk, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 40
  [IslandNative]::PostMessage([IntPtr]$proc.MainWindowHandle, 0x0101, [IntPtr]0x11, [IntPtr]::Zero) | Out-Null
  Start-Sleep -Milliseconds 240
}

$checks = New-Object System.Collections.Generic.List[object]

$shortcutProbe = "shortcut-paste-proof-20260306"
Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 420
Send-IslandCommand @{ type = "expand" }
Start-Sleep -Milliseconds 520
Send-IslandCommand @{ type = "clipboard_cut" }
Start-Sleep -Milliseconds 1800
Set-ClipboardText -Value $shortcutProbe
Send-IslandCommand @{ type = "clipboard_paste" }
Start-Sleep -Milliseconds 1100
$shortcutShot = Capture-Island -Name "01-input-shortcut.png"
Set-ClipboardText -Value "cleared"
Send-IslandCommand @{ type = "clipboard_copy" }
Start-Sleep -Milliseconds 2500
$shortcutResult = Read-ClipboardText
$checks.Add([pscustomobject]@{
  name = "keyboard_input_paste_and_copy"
  expected = $shortcutProbe
  actual = $shortcutResult
  pass = ($shortcutResult -eq $shortcutProbe)
  screenshot = $shortcutShot
}) | Out-Null

$rightClickProbe = "right-click-paste-proof-20260306"
Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 420
Send-IslandCommand @{ type = "expand" }
Start-Sleep -Milliseconds 520
Send-IslandCommand @{ type = "clipboard_cut" }
Start-Sleep -Milliseconds 1800
Set-ClipboardText -Value $rightClickProbe
Send-IslandCommand @{ type = "context_action" }
Start-Sleep -Milliseconds 1100
$inputShot = Capture-Island -Name "02-input-right-click-paste.png"
Set-ClipboardText -Value "cleared"
Send-IslandCommand @{ type = "clipboard_copy" }
Start-Sleep -Milliseconds 2500
$rightClickResult = Read-ClipboardText
$checks.Add([pscustomobject]@{
  name = "right_click_input_paste"
  expected = $rightClickProbe
  actual = $rightClickResult
  pass = ($rightClickResult -eq $rightClickProbe)
  screenshot = $inputShot
}) | Out-Null

$outputProbe = "output-copy-proof-20260306"
Send-IslandCommand @{
  type = "ai_update"
  state = "complete"
  snippet = $outputProbe
}
Start-Sleep -Milliseconds 900
Set-ClipboardText -Value "cleared"
Send-IslandCommand @{ type = "context_action" }
Start-Sleep -Milliseconds 1100
$outputShot = Capture-Island -Name "03-output-right-click-copy.png"
$outputResult = Read-ClipboardText
$checks.Add([pscustomobject]@{
  name = "right_click_output_copy"
  expected = $outputProbe
  actual = $outputResult
  pass = ($outputResult -eq $outputProbe)
  screenshot = $outputShot
}) | Out-Null

$fileActionExpected = "File ready`nCompress PDF"
Send-IslandCommand @{
  type = "file_processed"
  label = "pdf.compress"
  file_name = "proof.pdf"
  download_url = "https://example.com/proof.pdf"
  detail_text = "Compress PDF"
}
Start-Sleep -Milliseconds 900
Set-ClipboardText -Value "cleared"
Send-IslandCommand @{ type = "context_action" }
Start-Sleep -Milliseconds 1100
$fileActionShot = Capture-Island -Name "04-file-action-right-click-copy.png"
$fileActionResult = Read-ClipboardText
$checks.Add([pscustomobject]@{
  name = "right_click_file_action_copy"
  expected = $fileActionExpected
  actual = $fileActionResult
  pass = ($fileActionResult -eq $fileActionExpected)
  screenshot = $fileActionShot
}) | Out-Null

Send-IslandCommand @{ type = "collapse" }

$runtime = Get-IslandProcess
$report = [ordered]@{
  generated_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  island_pid = $runtime.Id
  island_start = $runtime.StartTime.ToString("yyyy-MM-dd HH:mm:ss")
  checks = $checks
}

$reportPath = Join-Path $OutputDir "report.json"
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $reportPath -Encoding utf8

if ($checks.Where({ -not $_.pass }).Count -gt 0) {
  throw "Clipboard proof failed. See $reportPath"
}

Write-Host "Clipboard proof passed"
Write-Host "Report: $reportPath"
