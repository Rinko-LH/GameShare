param(
    [ValidateRange(2, 3)]
    [int]$ClientCount = 2
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$target = $env:CARGO_TARGET_DIR
if (-not $target) { $target = Join-Path $repo '.cache\tauri-target' }
if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path $repo $target }
$target = [IO.Path]::GetFullPath($target)
$exe = Join-Path $target 'x86_64-pc-windows-msvc\debug\gameshare-tauri.exe'
$existing = @(Get-Process -Name gameshare-tauri -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$profiles = Join-Path $repo '.cache\manual-tauri-clients'
$first = Start-Job -ArgumentList $repo, $profiles, $target -ScriptBlock {
    param($root, $profiles, $target)
    Set-Location $root
    $env:CARGO_TARGET_DIR = $target
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $profiles 'client-1'
    # Windows PowerShell forwards native stderr through the job's error stream.
    npm.cmd run dev:desktop -- --no-watch 2>&1 | ForEach-Object { $_.ToString() }
    if ($LASTEXITCODE -ne 0) {
        throw "Tauri development command exited with code $LASTEXITCODE."
    }
}
$previousProfile = $env:WEBVIEW2_USER_DATA_FOLDER
$otherClients = @()
try {
    while ($true) {
        Receive-Job $first
        if ($first.State -in 'Completed', 'Failed', 'Stopped') {
            throw 'Tauri development startup exited before the first client appeared.'
        }
        $client = Get-Process -Name gameshare-tauri -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $exe -and $_.Id -notin $existing } |
            Select-Object -First 1
        if ($client) { break }
        Start-Sleep -Milliseconds 500
    }
    for ($index = 2; $index -le $ClientCount; $index++) {
        $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $profiles "client-$index"
        $otherClients += Start-Process -FilePath $exe -WorkingDirectory (Join-Path $repo 'apps\tauri') -PassThru
    }
    Receive-Job $first -Wait
} finally {
    $env:WEBVIEW2_USER_DATA_FOLDER = $previousProfile
    foreach ($client in $otherClients) {
        if (-not $client.HasExited) { Stop-Process -InputObject $client -ErrorAction SilentlyContinue }
    }
    Stop-Job $first
    Remove-Job $first
}
