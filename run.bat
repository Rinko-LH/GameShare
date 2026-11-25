@echo off
setlocal
pushd "%~dp0" || exit /b 1
powershell.exe -NoProfile -Command "$app = Get-ChildItem -LiteralPath '../release' -Filter 'GameShare-Tauri*.exe' -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Directory.Name -like '*-tauri-*-portable*' } | Sort-Object LastWriteTimeUtc, FullName -Descending | Select-Object -First 1; if (-not $app) { Write-Host 'No Tauri portable release found. Use dev.bat to run from source.'; exit 1 }; Start-Process -FilePath $app.FullName -WorkingDirectory $app.DirectoryName"
set "STATUS=%errorlevel%"
popd
if not "%STATUS%"=="0" pause
exit /b %STATUS%
