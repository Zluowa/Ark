param(
  [string]$OutDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-08-island-iopaint-polish-round",
  [string]$ImagePath = "D:\Moss\projects\omniagent-new\app\test-screenshots\2026-03-07-iopaint-full-suite\00-source-edit.png"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$CutoutPrompt = ([char[]](0x6263, 0x9664, 0x80CC, 0x666F)) -join ""
$WatermarkPrompt = ([char[]](0x53BB, 0x9664, 0x6C34, 0x5370)) -join ""

Add-Type @"
using System;
using System.Runtime.InteropServices;

public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}

public static class User32Native {
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
  $ok = [User32Native]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)
  if (-not $ok) { throw "GetWindowRect failed" }
  return @{
    Left = $rect.Left
    Top = $rect.Top
    Width = ($rect.Right - $rect.Left)
    Height = ($rect.Bottom - $rect.Top)
  }
}

function Capture-Island([string]$FilePath) {
  Capture-IslandRegion -FilePath $FilePath -Mode "preview"
}

function Get-IslandCaptureRegion([string]$Mode) {
  $r = Get-IslandRect
  switch ($Mode) {
    "action" {
      $width = 320
      $height = 112
      $left = $r.Left + [int](($r.Width - $width) / 2)
      $top = $r.Top + 28
    }
    "preview" {
      $width = 404
      $height = 372
      $left = $r.Left + [int](($r.Width - $width) / 2)
      $top = $r.Top + 16
    }
    "edit" {
      $width = 404
      $height = 408
      $left = $r.Left + [int](($r.Width - $width) / 2)
      $top = $r.Top + 16
    }
    default {
      $width = 404
      $height = 408
      $left = $r.Left + [int](($r.Width - $width) / 2)
      $top = $r.Top + 16
    }
  }

  return @{
    Left = $left
    Top = $top
    Width = $width
    Height = $height
  }
}

function Capture-IslandRegion([string]$FilePath, [string]$Mode) {
  $r = Get-IslandCaptureRegion -Mode $Mode
  $bmp = New-Object System.Drawing.Bitmap($r.Width, $r.Height)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($FilePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

function Send-IslandCommand([hashtable]$CommandBody) {
  $json = $CommandBody | ConvertTo-Json -Compress
  $client = New-Object System.Net.WebClient
  $client.Headers["Content-Type"] = "application/json; charset=utf-8"
  $client.Encoding = [System.Text.Encoding]::UTF8
  $null = $client.UploadString("http://127.0.0.1:9800", "POST", $json)
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
    return Get-Content -Raw $FilePath | ConvertFrom-Json
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
    Start-Sleep -Milliseconds 450
  } while ((Get-Date) -lt $deadline)

  $finalState = Get-IslandDebugState -FilePath $DebugPath
  $expected = ($States -join ", ")
  $actual = if ($null -eq $finalState) { "unknown" } else { [string]$finalState.pill_state }
  throw "Timed out waiting for island state [$expected]. Last state: $actual"
}

function Click-Absolute([int]$X, [int]$Y) {
  [User32Native]::SetCursorPos($X, $Y) | Out-Null
  Start-Sleep -Milliseconds 80
  [User32Native]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [User32Native]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Click-Relative([int]$X, [int]$Y) {
  $r = Get-IslandRect
  Click-Absolute -X ($r.Left + $X) -Y ($r.Top + $Y)
}

function Drag-RelativeRect([double]$LeftNorm, [double]$TopNorm, [double]$WidthNorm, [double]$HeightNorm) {
  $r = Get-IslandRect
  $pillLeft = [int](($r.Width - 360) / 2)
  $displayLeft = $pillLeft + 44
  $displayTop = 58
  $displayWidth = 320
  $displayHeight = 240

  $left = [int]($r.Left + $displayLeft + $displayWidth * $LeftNorm)
  $top = [int]($r.Top + $displayTop + $displayHeight * $TopNorm)
  $right = [int]($r.Left + $displayLeft + $displayWidth * ($LeftNorm + $WidthNorm))
  $bottom = [int]($r.Top + $displayTop + $displayHeight * ($TopNorm + $HeightNorm))

  [User32Native]::SetCursorPos($left, $top) | Out-Null
  Start-Sleep -Milliseconds 80
  [User32Native]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
  $lines = 7
  for ($i = 0; $i -lt $lines; $i++) {
    $y = [int]($top + (($bottom - $top) * $i / [Math]::Max($lines - 1, 1)))
    $from = if (($i % 2) -eq 0) { $left } else { $right }
    $to = if (($i % 2) -eq 0) { $right } else { $left }
    [User32Native]::SetCursorPos($from, $y) | Out-Null
    Start-Sleep -Milliseconds 20
    $steps = 10
    for ($step = 0; $step -le $steps; $step++) {
      $x = [int]($from + (($to - $from) * $step / $steps))
      [User32Native]::SetCursorPos($x, $y) | Out-Null
      Start-Sleep -Milliseconds 18
    }
  }
  [User32Native]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

function Set-IslandClipboardText([string]$Text) {
  Set-Clipboard -Value $Text
  Start-Sleep -Milliseconds 120
  Send-IslandCommand @{ type = "clipboard_paste" }
}

function Open-ImageEditState([string]$Instruction, [string]$Prefix) {
  Send-IslandCommand @{ type = "collapse" }
  Start-Sleep -Milliseconds 700
  Send-IslandCommand @{
    type = "process_file"
    path = $ImagePath
    instruction = $Instruction
  }
  Start-Sleep -Seconds 3
  Capture-IslandRegion -FilePath (Join-Path $OutDir "$Prefix-01-image-action.png") -Mode "action"

  $r = Get-IslandRect
  $pillWidth = 240
  $pillHeight = 64
  $pillLeft = [int](($r.Width - $pillWidth) / 2)
  $pillTop = 40
  Click-Relative -X ($pillLeft + 34) -Y ($pillTop + [int]($pillHeight / 2))
  Start-Sleep -Milliseconds 900
  Capture-IslandRegion -FilePath (Join-Path $OutDir "$Prefix-02-preview.png") -Mode "preview"

  Send-IslandCommand @{ type = "begin_image_edit" }
  Start-Sleep -Milliseconds 800
  Capture-IslandRegion -FilePath (Join-Path $OutDir "$Prefix-03-edit-open.png") -Mode "edit"
}

function Apply-ImageEdit([string]$Prefix, [int]$TimeoutSeconds, [string]$DebugPath) {
  Send-IslandCommand @{ type = "image_edit_apply" }
  Start-Sleep -Seconds 2
  Capture-IslandRegion -FilePath (Join-Path $OutDir "$Prefix-04-processing.png") -Mode "action"
  $state = Wait-ForIslandState -States @("image_action") -TimeoutSeconds $TimeoutSeconds -DebugPath $DebugPath
  Capture-IslandRegion -FilePath (Join-Path $OutDir "$Prefix-05-result-action.png") -Mode "action"

  Send-IslandCommand @{ type = "open_image_preview" }
  $null = Wait-ForIslandState -States @("image_preview") -TimeoutSeconds 8 -DebugPath $DebugPath
  Start-Sleep -Milliseconds 450
  Capture-IslandRegion -FilePath (Join-Path $OutDir "$Prefix-06-result-preview.png") -Mode "preview"

  $state | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $OutDir "$Prefix-05-result-state.json") -Encoding utf8

  $r = Get-IslandRect
  Click-Relative -X ([int]($r.Width / 2)) -Y 366
  Start-Sleep -Milliseconds 600
}

if (-not (Test-Path $ImagePath)) {
  throw "source image not found: $ImagePath"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$debugStatePath = Join-Path $OutDir "_current-state.json"

$objectLeftNorm = 618 / 1024
$objectTopNorm = 228 / 768
$objectWidthNorm = 236 / 1024
$objectHeightNorm = 236 / 768

$textLeftNorm = 174 / 1024
$textTopNorm = 96 / 768
$textWidthNorm = 676 / 1024
$textHeightNorm = 84 / 768

Open-ImageEditState -Instruction "open iopaint editor" -Prefix "11-remove-object"
Drag-RelativeRect -LeftNorm $objectLeftNorm -TopNorm $objectTopNorm -WidthNorm $objectWidthNorm -HeightNorm $objectHeightNorm
Send-IslandCommand @{ type = "image_edit_set_prompt"; text = "Remove the orange block and rebuild the dark background naturally." }
Start-Sleep -Milliseconds 300
Capture-IslandRegion -FilePath (Join-Path $OutDir "11-remove-object-03b-ready.png") -Mode "edit"
Apply-ImageEdit -Prefix "11-remove-object" -TimeoutSeconds 60 -DebugPath $debugStatePath

Open-ImageEditState -Instruction "open iopaint editor" -Prefix "12-replace-object"
Drag-RelativeRect -LeftNorm $objectLeftNorm -TopNorm $objectTopNorm -WidthNorm $objectWidthNorm -HeightNorm $objectHeightNorm
Send-IslandCommand @{ type = "image_edit_set_prompt"; text = "Replace the masked orange block with a matte green geometric emblem." }
Start-Sleep -Milliseconds 300
Capture-IslandRegion -FilePath (Join-Path $OutDir "12-replace-object-03b-ready.png") -Mode "edit"
Apply-ImageEdit -Prefix "12-replace-object" -TimeoutSeconds 90 -DebugPath $debugStatePath

Open-ImageEditState -Instruction "open iopaint editor" -Prefix "13-add-text"
Send-IslandCommand @{ type = "image_edit_add_mask_rect"; left_norm = $textLeftNorm; top_norm = $textTopNorm; width_norm = $textWidthNorm; height_norm = $textHeightNorm }
Send-IslandCommand @{ type = "image_edit_set_prompt"; text = "Write OMNIAGENT 2026`nBold white sans-serif with subtle glow`nCenter it in the header band." }
Start-Sleep -Milliseconds 300
Capture-IslandRegion -FilePath (Join-Path $OutDir "13-add-text-03b-ready.png") -Mode "edit"
Apply-ImageEdit -Prefix "13-add-text" -TimeoutSeconds 60 -DebugPath $debugStatePath

Open-ImageEditState -Instruction "open iopaint editor" -Prefix "14-outpaint"
Send-IslandCommand @{ type = "image_edit_set_prompt"; text = "Extend the poster scene left and right with matching geometry and lighting. Make it wider." }
Start-Sleep -Milliseconds 300
Capture-IslandRegion -FilePath (Join-Path $OutDir "14-outpaint-03b-ready.png") -Mode "edit"
Apply-ImageEdit -Prefix "14-outpaint" -TimeoutSeconds 150 -DebugPath $debugStatePath

Open-ImageEditState -Instruction "open iopaint editor" -Prefix "15-remove-background"
Send-IslandCommand @{ type = "image_edit_set_prompt"; text = $CutoutPrompt }
Start-Sleep -Milliseconds 300
Capture-IslandRegion -FilePath (Join-Path $OutDir "15-remove-background-03b-ready.png") -Mode "edit"
Apply-ImageEdit -Prefix "15-remove-background" -TimeoutSeconds 120 -DebugPath $debugStatePath

Open-ImageEditState -Instruction "open iopaint editor" -Prefix "16-remove-watermark"
Send-IslandCommand @{ type = "image_edit_set_prompt"; text = $WatermarkPrompt }
Start-Sleep -Milliseconds 300
Capture-IslandRegion -FilePath (Join-Path $OutDir "16-remove-watermark-03b-ready.png") -Mode "edit"
Apply-ImageEdit -Prefix "16-remove-watermark" -TimeoutSeconds 120 -DebugPath $debugStatePath

$report = @{
  outDir = $OutDir
  sourceImage = $ImagePath
  generatedAt = (Get-Date).ToString("s")
  shots = (Get-ChildItem $OutDir -Filter *.png | Sort-Object Name | ForEach-Object { $_.Name })
}
$report | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $OutDir "report.json") -Encoding utf8
Write-Host "[island-iopaint-native-proof] outDir=$OutDir"
