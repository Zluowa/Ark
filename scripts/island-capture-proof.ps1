param(
  [string]$OutDir = "D:\Moss\projects\omniagent-new\desktop\test-screenshots\2026-03-08-island-capture-round",
  [switch]$SkipAudio,
  [switch]$SkipScreen
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Speech

$signature = @"
using System;
using System.Runtime.InteropServices;

public static class IslandCaptureNative {
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
    public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, int nFlags);
}
"@
Add-Type -TypeDefinition $signature

$AudioPrompt = "Audio note update. Ship the new island recorder. Next step: verify screen capture."
$DebugPath = Join-Path $OutDir "_capture-state.json"
$ReportPath = Join-Path $OutDir "report.json"
$ReadmePath = Join-Path $OutDir "README.txt"
$ScreenDemoPath = Join-Path $OutDir "_screen-demo.ps1"

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
  [IslandCaptureNative]::ShowWindow([IntPtr]$proc.MainWindowHandle, 5) | Out-Null
  Start-Sleep -Milliseconds 120
  [IslandCaptureNative]::SetForegroundWindow([IntPtr]$proc.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 220
}

function Get-IslandRect {
  $proc = Get-IslandProcess
  $rect = New-Object IslandCaptureNative+RECT
  if (-not [IslandCaptureNative]::GetWindowRect([IntPtr]$proc.MainWindowHandle, [ref]$rect)) {
    throw "GetWindowRect failed"
  }
  return [pscustomobject]@{
    Left = $rect.Left
    Top = $rect.Top
    Width = $rect.Right - $rect.Left
    Height = $rect.Bottom - $rect.Top
  }
}

function Send-IslandCommand {
  param([hashtable]$Payload)
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:9800" -Method Post -ContentType "application/json" -Body $json | Out-Null
  } catch {
    throw "Island command failed for payload: $json"
  }
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
    [string]$DebugFile,
    [scriptblock]$Predicate
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $state = Get-IslandDebugState -FilePath $DebugFile
    if ($null -ne $state -and $States -contains [string]$state.pill_state) {
      if ($null -eq $Predicate -or (& $Predicate $state)) {
        return $state
      }
    }
    Start-Sleep -Milliseconds 400
  } while ((Get-Date) -lt $deadline)

  $finalState = Get-IslandDebugState -FilePath $DebugFile
  $actual = if ($null -eq $finalState) { "unknown" } else { [string]$finalState.pill_state }
  throw "Timed out waiting for state [$($States -join ', ')]. Last state: $actual"
}

function Get-CaptureRegion([string]$Mode) {
  $rect = Get-IslandRect
  switch ($Mode) {
    "stack" {
      $width = 392; $height = 446
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 16
    }
    "audio" {
      $width = 396; $height = 212
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 18
    }
    "screen" {
      $width = 396; $height = 218
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 18
    }
    "output" {
      $width = 398; $height = 252
      $left = $rect.Left + [int](($rect.Width - $width) / 2)
      $top = $rect.Top + 18
    }
    "file" {
      $width = 360; $height = 156
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

  return @{
    Left = $left
    Top = $top
    Width = $width
    Height = $height
  }
}

function Capture-Island {
  param([string]$FilePath, [string]$Mode)
  Activate-Island
  $window = Get-IslandRect
  $r = Get-CaptureRegion -Mode $Mode
  $full = New-Object System.Drawing.Bitmap($window.Width, $window.Height)
  $g = [System.Drawing.Graphics]::FromImage($full)
  $hdc = $g.GetHdc()
  $proc = Get-IslandProcess
  [IslandCaptureNative]::PrintWindow([IntPtr]$proc.MainWindowHandle, $hdc, 2) | Out-Null
  $g.ReleaseHdc($hdc)
  $cropRect = New-Object System.Drawing.Rectangle(
    ($r.Left - $window.Left),
    ($r.Top - $window.Top),
    $r.Width,
    $r.Height
  )
  $crop = $full.Clone($cropRect, $full.PixelFormat)
  $crop.Save($FilePath, [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose()
  $g.Dispose()
  $full.Dispose()
}

function Get-ConfiguredDownloadDir {
  $configPath = Join-Path $HOME ".winisland\config.toml"
  if (Test-Path $configPath) {
    $line = Get-Content $configPath | Where-Object { $_ -match '^download_dir\s*=' } | Select-Object -First 1
    if ($line) {
      $value = ($line -replace '^download_dir\s*=\s*', '').Trim().Trim('"')
      if ($value) {
        return $value
      }
    }
  }

  $shell = New-Object -ComObject Shell.Application
  $downloads = $shell.Namespace('shell:Downloads')
  if ($downloads -and $downloads.Self.Path) {
    return $downloads.Self.Path
  }
  return (Join-Path $HOME "Downloads")
}

function Get-CaptureDir {
  Join-Path (Get-ConfiguredDownloadDir) "OmniAgent Captures"
}

function Get-LatestCaptureFile {
  param(
    [string]$Prefix,
    [datetime]$Since
  )

  $captureDir = Get-CaptureDir
  if (-not (Test-Path $captureDir)) {
    return $null
  }

  return Get-ChildItem $captureDir -Filter "$Prefix*" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $Since -and $_.Length -gt 0 } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

function Get-LatestTempArtifact {
  param(
    [string]$Prefix,
    [string]$Extension,
    [datetime]$Since
  )

  $tempDir = [System.IO.Path]::GetTempPath()
  if (-not (Test-Path $tempDir)) {
    return $null
  }

  return Get-ChildItem $tempDir -Filter "$Prefix*.$Extension" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $Since -and $_.Length -gt 0 } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

function Start-ScreenDemoProcess {
  $script = @'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "OmniAgent Capture Demo"
$form.StartPosition = "Manual"
$form.Location = New-Object System.Drawing.Point(120, 120)
$form.Size = New-Object System.Drawing.Size(760, 420)
$form.FormBorderStyle = "FixedDialog"
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 26)

$title = New-Object System.Windows.Forms.Label
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(34, 34)
$title.Size = New-Object System.Drawing.Size(680, 56)
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 26, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::White

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.AutoSize = $false
$subtitle.Location = New-Object System.Drawing.Point(36, 98)
$subtitle.Size = New-Object System.Drawing.Size(680, 32)
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Regular)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(210, 214, 224)

$panel = New-Object System.Windows.Forms.Panel
$panel.Location = New-Object System.Drawing.Point(38, 168)
$panel.Size = New-Object System.Drawing.Size(684, 164)
$panel.BackColor = [System.Drawing.Color]::FromArgb(38, 38, 52)

$badge = New-Object System.Windows.Forms.Label
$badge.AutoSize = $false
$badge.Location = New-Object System.Drawing.Point(22, 22)
$badge.Size = New-Object System.Drawing.Size(220, 36)
$badge.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$badge.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 14, [System.Drawing.FontStyle]::Bold)
$badge.ForeColor = [System.Drawing.Color]::White
$badge.BackColor = [System.Drawing.Color]::FromArgb(84, 96, 255)

$status = New-Object System.Windows.Forms.Label
$status.AutoSize = $false
$status.Location = New-Object System.Drawing.Point(22, 82)
$status.Size = New-Object System.Drawing.Size(620, 56)
$status.Font = New-Object System.Drawing.Font("Consolas", 18, [System.Drawing.FontStyle]::Regular)
$status.ForeColor = [System.Drawing.Color]::FromArgb(246, 248, 255)

$panel.Controls.Add($badge)
$panel.Controls.Add($status)
$form.Controls.Add($title)
$form.Controls.Add($subtitle)
$form.Controls.Add($panel)

$steps = @(
  @{ Title = "Screen Capture Demo"; Subtitle = "Stage 1 • open the live capture activity"; Badge = "Capture Ready"; Status = "STEP 1  OPEN SCREEN RECORD"; Back = [System.Drawing.Color]::FromArgb(38, 38, 52); BadgeBack = [System.Drawing.Color]::FromArgb(84, 96, 255) },
  @{ Title = "Screen Capture Demo"; Subtitle = "Stage 2 • visible text changes for Gemini"; Badge = "Recording Live"; Status = "STEP 2  STATUS PANEL CHANGED"; Back = [System.Drawing.Color]::FromArgb(46, 26, 38); BadgeBack = [System.Drawing.Color]::FromArgb(255, 108, 92) },
  @{ Title = "Screen Capture Demo"; Subtitle = "Stage 3 • final frame before stop"; Badge = "Ready to Stop"; Status = "STEP 3  SUMMARY SHOULD MENTION CHANGES"; Back = [System.Drawing.Color]::FromArgb(26, 44, 40); BadgeBack = [System.Drawing.Color]::FromArgb(88, 196, 138) }
)

$index = 0
$apply = {
  $step = $steps[$index]
  $title.Text = $step.Title
  $subtitle.Text = $step.Subtitle
  $badge.Text = $step.Badge
  $badge.BackColor = $step.BadgeBack
  $status.Text = $step.Status
  $panel.BackColor = $step.Back
}

& $apply

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1100
$timer.Add_Tick({
  $script:index++
  if ($script:index -ge $steps.Count) {
    $timer.Stop()
    $form.Close()
    return
  }
  & $apply
})

$form.Add_Shown({ $timer.Start() })
[void]$form.ShowDialog()
'@

  $script | Set-Content -Path $ScreenDemoPath -Encoding utf8
  return Start-Process powershell -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $ScreenDemoPath
  ) -PassThru
}

function New-AudioProofSource {
  param([string]$FilePath)

  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  try {
    $synth.Rate = -1
    $synth.Volume = 100
    $synth.SetOutputToWaveFile($FilePath)
    $synth.Speak($AudioPrompt)
  } finally {
    $synth.Dispose()
  }

  if (-not (Test-Path $FilePath)) {
    throw "Audio proof source was not created"
  }

  return $FilePath
}

function Validate-SummaryText {
  param([string]$Text, [string]$Label)
  if ([string]::IsNullOrWhiteSpace($Text)) {
    $trimmed = ""
  } else {
    $trimmed = $Text.Trim()
  }
  if (-not $trimmed) {
    throw "$Label summary was empty"
  }
  if ($trimmed -match 'failed|timed out|empty|missing|not configured|upload failed|analysis failed') {
    throw "$Label summary looks like a failure: $trimmed"
  }
  return $trimmed
}

try {
  Send-IslandCommand @{ type = "collapse" }
  Send-IslandCommand @{ type = "audio_notes_set_source_file"; path = "" }
} catch {
  throw "9800 command endpoint is not reachable"
}

if (Test-Path $OutDir) {
  Remove-Item -Path $OutDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

$states = @{}
$captureFiles = @{}

Send-IslandCommand @{ type = "collapse" }
Start-Sleep -Milliseconds 800

Send-IslandCommand @{ type = "open_stack" }
$stackState = Wait-ForIslandState -States @("tool_panel") -TimeoutSeconds 10 -DebugFile $DebugPath
$states.stack = $stackState
Start-Sleep -Milliseconds 320
$stackShot = Join-Path $OutDir "01-stack-capture-entry.png"
Capture-Island -FilePath $stackShot -Mode "stack"

$audioShot = $null
$audioFileReadyShot = $null
$audioTranscriptShot = $null
$audioAskAiInputShot = $null
$audioOutputShot = $null
$audioOutputText = $null
$audioFile = $null
$audioTranscriptFile = $null
$screenShot = $null
$screenSummaryShot = $null
$screenSummaryText = $null
$screenReportPath = $null
$screenFile = $null

if (-not $SkipAudio) {
  $audioStartedAt = Get-Date
  $audioSourcePath = New-AudioProofSource -FilePath (Join-Path $OutDir "_audio-proof-source.wav")
  Send-IslandCommand @{ type = "audio_notes_set_source_file"; path = $audioSourcePath }
  Send-IslandCommand @{ type = "open_audio_notes" }
  $audioRunState = Wait-ForIslandState -States @("audio_expand") -TimeoutSeconds 10 -DebugFile $DebugPath
  $states.audioRecording = $audioRunState
  Start-Sleep -Milliseconds 1400
  $audioShot = Join-Path $OutDir "02-audio-notes-recording.png"
  Capture-Island -FilePath $audioShot -Mode "audio"

  Start-Sleep -Milliseconds 5200

  Send-IslandCommand @{ type = "audio_notes_stop" }
  $audioFileState = Wait-ForIslandState -States @("file_ready") -TimeoutSeconds 120 -DebugFile $DebugPath
  $states.audioFileReady = $audioFileState
  Start-Sleep -Milliseconds 420
  $audioFileReadyShot = Join-Path $OutDir "03-audio-notes-file-ready.png"
  Capture-Island -FilePath $audioFileReadyShot -Mode "file"
  $audioFileState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "03-audio-notes-file-ready-state.json") -Encoding utf8
  $audioFile = Get-LatestCaptureFile -Prefix "audio-note-" -Since $audioStartedAt
  if (-not $audioFile) {
    throw "Audio Notes capture file was not found"
  }
  if ($audioFile.Extension -ne ".mp3") {
    throw "Audio Notes capture did not land as mp3: $($audioFile.FullName)"
  }
  $captureFiles.audio = $audioFile

  $audioTranscriptStartedAt = Get-Date
  $audioTranscriptPrefix = "$([System.IO.Path]::GetFileNameWithoutExtension($audioFile.Name))-omni-artifact-"
  Send-IslandCommand @{ type = "submit_file_ready_with_instruction"; instruction = "transcribe to text file" }
  $audioTranscriptState = Wait-ForIslandState -States @("file_ready") -TimeoutSeconds 120 -DebugFile $DebugPath -Predicate {
    param($state)
    $null -ne (Get-LatestTempArtifact -Prefix $audioTranscriptPrefix -Extension "txt" -Since $audioTranscriptStartedAt)
  }
  $states.audioTranscript = $audioTranscriptState
  $audioTranscriptFile = Get-LatestTempArtifact -Prefix $audioTranscriptPrefix -Extension "txt" -Since $audioTranscriptStartedAt
  if (-not $audioTranscriptFile) {
    throw "Audio transcript text file was not found"
  }
  Start-Sleep -Milliseconds 420
  $audioTranscriptShot = Join-Path $OutDir "04-audio-notes-transcript-ready.png"
  Capture-Island -FilePath $audioTranscriptShot -Mode "file"
  $audioTranscriptState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "04-audio-notes-transcript-ready-state.json") -Encoding utf8

  Send-IslandCommand @{ type = "activate_file_ready_quick_action" }
  $audioAskAiInputState = Wait-ForIslandState -States @("input") -TimeoutSeconds 20 -DebugFile $DebugPath -Predicate {
    param($state)
    [bool]$state.input_file_context_active
  }
  $states.audioAskAiInput = $audioAskAiInputState
  Start-Sleep -Milliseconds 320
  $audioAskAiInputShot = Join-Path $OutDir "05-audio-notes-ask-ai-input.png"
  Capture-Island -FilePath $audioAskAiInputShot -Mode "file"
  $audioAskAiInputState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "05-audio-notes-ask-ai-input-state.json") -Encoding utf8

  Send-IslandCommand @{ type = "submit_input_with_text"; text = "Summarize this transcript into concise action items." }
  $audioOutputState = Wait-ForIslandState -States @("output") -TimeoutSeconds 120 -DebugFile $DebugPath -Predicate {
    param($state)
    -not [string]::IsNullOrWhiteSpace([string]$state.output_text)
  }
  $states.audioOutput = $audioOutputState
  $audioOutputText = Validate-SummaryText -Text ([string]$audioOutputState.output_text) -Label "Audio Notes AI output"
  Start-Sleep -Milliseconds 420
  $audioOutputShot = Join-Path $OutDir "06-audio-notes-ai-output.png"
  Capture-Island -FilePath $audioOutputShot -Mode "output"
  $audioOutputState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "06-audio-notes-ai-output-state.json") -Encoding utf8
  Send-IslandCommand @{ type = "audio_notes_set_source_file"; path = "" }

  Send-IslandCommand @{ type = "collapse" }
  Start-Sleep -Milliseconds 700
}

if (-not $SkipScreen) {
  $screenStartedAt = Get-Date
  Send-IslandCommand @{ type = "open_screen_record" }
  $screenRunState = Wait-ForIslandState -States @("screen_expand") -TimeoutSeconds 10 -DebugFile $DebugPath
  $states.screenRecording = $screenRunState
  $screenDemo = Start-ScreenDemoProcess
  Start-Sleep -Seconds 1
  $screenShot = Join-Path $OutDir "07-screen-record-recording.png"
  Capture-Island -FilePath $screenShot -Mode "screen"
  Start-Sleep -Seconds 4
  Send-IslandCommand @{ type = "screen_record_stop" }
  if ($screenDemo -and -not $screenDemo.HasExited) {
    try {
      $screenDemo.WaitForExit(5000) | Out-Null
    } catch {
    }
  }
  $screenSummaryState = Wait-ForIslandState -States @("file_action") -TimeoutSeconds 180 -DebugFile $DebugPath -Predicate {
    param($state)
    -not [string]::IsNullOrWhiteSpace([string]$state.output_text) -and [string]$state.action_file_name -like '*.md'
  }
  $states.screenSummary = $screenSummaryState
  $screenSummaryText = Validate-SummaryText -Text ([string]$screenSummaryState.output_text) -Label "Screen Record"
  $screenReportPath = [string]$screenSummaryState.action_download_url
  Start-Sleep -Milliseconds 420
  $screenSummaryShot = Join-Path $OutDir "08-screen-record-summary.png"
  Capture-Island -FilePath $screenSummaryShot -Mode "file"
  $screenSummaryState | ConvertTo-Json -Depth 8 | Set-Content -Path (Join-Path $OutDir "08-screen-record-summary-state.json") -Encoding utf8
  $screenFile = Get-LatestCaptureFile -Prefix "screen-record-" -Since $screenStartedAt
  if (-not $screenFile) {
    throw "Screen Record capture file was not found"
  }
  $captureFiles.screen = $screenFile
}

$readme = @(
  "Native island capture proof"
  "generated_at=$(Get-Date -Format s)"
  "out_dir=$OutDir"
  "capture_dir=$(Get-CaptureDir)"
  $(if (-not $SkipAudio) { "audio_proof_source=$(Join-Path $OutDir '_audio-proof-source.wav')" })
  $(if (-not $SkipAudio) { "note=Audio Notes proof used a locally generated spoken wav routed through the native capture path because unattended live mic capture on this workstation is too weak for stable ASR." })
  ""
  "shots:"
  "01-stack-capture-entry.png - stack with Audio Notes and Screen Record tiles visible"
  $(if (-not $SkipAudio) { "02-audio-notes-recording.png - Audio Notes expanded recording state" })
  $(if (-not $SkipAudio) { "03-audio-notes-file-ready.png - Audio Notes mp3 file-first delivery state with To Text affordance" })
  $(if (-not $SkipAudio) { "04-audio-notes-transcript-ready.png - transcript text file re-entered into FileReady" })
  $(if (-not $SkipAudio) { "05-audio-notes-ask-ai-input.png - Ask AI moves into Input with transcript context attached" })
  $(if (-not $SkipAudio) { "06-audio-notes-ai-output.png - transcript submitted through the normal AI channel" })
  $(if (-not $SkipScreen) { "07-screen-record-recording.png - Screen Record expanded recording state" })
  $(if (-not $SkipScreen) { "08-screen-record-summary.png - Screen Record downloadable markdown report delivery state" })
) -join [Environment]::NewLine
$readme | Set-Content -Path $ReadmePath -Encoding utf8

$report = @{
  generatedAt = (Get-Date).ToString("s")
  outDir = $OutDir
  captureDir = Get-CaptureDir
  audioPrompt = $AudioPrompt
  audioProofSource = if (-not $SkipAudio) { Join-Path $OutDir "_audio-proof-source.wav" } else { $null }
  skipped = @{
    audio = [bool]$SkipAudio
    screen = [bool]$SkipScreen
  }
  screenshots = @{
    stack = [System.IO.Path]::GetFileName($stackShot)
    audioRecording = if ($audioShot) { [System.IO.Path]::GetFileName($audioShot) } else { $null }
    audioFileReady = if ($audioFileReadyShot) { [System.IO.Path]::GetFileName($audioFileReadyShot) } else { $null }
    audioTranscript = if ($audioTranscriptShot) { [System.IO.Path]::GetFileName($audioTranscriptShot) } else { $null }
    audioAskAiInput = if ($audioAskAiInputShot) { [System.IO.Path]::GetFileName($audioAskAiInputShot) } else { $null }
    audioAiOutput = if ($audioOutputShot) { [System.IO.Path]::GetFileName($audioOutputShot) } else { $null }
    screenRecording = if ($screenShot) { [System.IO.Path]::GetFileName($screenShot) } else { $null }
    screenSummary = if ($screenSummaryShot) { [System.IO.Path]::GetFileName($screenSummaryShot) } else { $null }
  }
  captureFiles = @{
    audio = if ($audioFile) {
      @{
        path = $audioFile.FullName
        bytes = $audioFile.Length
        lastWriteTime = $audioFile.LastWriteTime.ToString("s")
      }
    } else {
      $null
    }
    screen = if ($screenFile) {
      @{
        path = $screenFile.FullName
        bytes = $screenFile.Length
        lastWriteTime = $screenFile.LastWriteTime.ToString("s")
      }
    } else {
      $null
    }
  }
  reportFiles = @{
    audioTranscript = if ($audioTranscriptFile) {
      @{
        path = $audioTranscriptFile.FullName
        bytes = $audioTranscriptFile.Length
        lastWriteTime = $audioTranscriptFile.LastWriteTime.ToString("s")
      }
    } else {
      $null
    }
    screen = if ($screenReportPath) { @{ path = $screenReportPath } } else { $null }
  }
  summaries = @{
    audio = $audioOutputText
    screen = $screenSummaryText
  }
  states = @{
    stack = $states.stack
    audioRecording = $states.audioRecording
    audioFileReady = $states.audioFileReady
    audioTranscript = $states.audioTranscript
    audioAskAiInput = $states.audioAskAiInput
    audioOutput = $states.audioOutput
    screenRecording = $states.screenRecording
    screenSummary = $states.screenSummary
  }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $ReportPath -Encoding utf8

Write-Host "[island-capture-proof] outDir=$OutDir"
Write-Host "[island-capture-proof] report=$ReportPath"
