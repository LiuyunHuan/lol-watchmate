$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($request.mode -eq 'voices') {
        $voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
            @{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name }
        })
        ConvertTo-Json -InputObject $voices -Compress
    } else {
        if ($request.voice) {
            $synth.SelectVoice([string]$request.voice)
        } else {
            $chinese = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
            if (-not $chinese) { throw 'No Chinese Windows speech voice installed' }
            $synth.SelectVoice($chinese.VoiceInfo.Name)
        }
        $synth.Rate = [int]$request.rate
        $stream = New-Object System.IO.MemoryStream
        try {
            $synth.SetOutputToWaveStream($stream)
            $synth.Speak([string]$request.text)
            $synth.SetOutputToNull()
            [Convert]::ToBase64String($stream.ToArray())
        } finally { $stream.Dispose() }
    }
} finally { $synth.Dispose() }
