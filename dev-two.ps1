$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$target = $env:CARGO_TARGET_DIR
if (-not $target) { $target = Join-Path $repo '.cache\tauri-target' }
$exe = Join-Path $target 'x86_64-pc-windows-msvc\debug\gameshare-tauri.exe'
$existing = @(Get-Process -Name gameshare-tauri -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$profiles = Join-Path $repo '.cache\manual-tauri-clients'
$first = Start-Job -ArgumentList $repo, $profiles, $target -ScriptBlock {
    param($root, $profiles, $target)
    Set-Location $root
    $env:CARGO_TARGET_DIR = $target
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $profiles 'client-1'
    npm.cmd run dev:desktop -- --no-watch
}
$previousProfile = $env:WEBVIEW2_USER_DATA_FOLDER
try {
    while ($true) {
        Receive-Job $first
        if ($first.State -ne 'Running') { throw 'Tauri development startup exited.' }
        $client = Get-Process -Name gameshare-tauri -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $exe -and $_.Id -notin $existing } |
            Select-Object -First 1
        if ($client) { break }
        Start-Sleep -Milliseconds 500
    }
    $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $profiles 'client-2'
    $second = Start-Process -FilePath $exe -WorkingDirectory (Join-Path $repo 'apps\tauri') -PassThru
    Receive-Job $first -Wait
} finally {
    $env:WEBVIEW2_USER_DATA_FOLDER = $previousProfile
    if ($second -and -not $second.HasExited) { Stop-Process -InputObject $second -ErrorAction SilentlyContinue }
    Stop-Job $first
    Remove-Job $first
}
