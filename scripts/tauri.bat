@echo off
setlocal
for %%I in ("%~dp0..") do set "TAURI_REPO=%%~fI"
if defined GAMESHARE_NODE_DIR if exist "%GAMESHARE_NODE_DIR%\node.exe" set "PATH=%GAMESHARE_NODE_DIR%;%PATH%"
set "TAURI_CLI=%TAURI_REPO%\node_modules\@tauri-apps\cli\tauri.js"
if not exist "%TAURI_CLI%" (
  echo Tauri CLI is missing. Run npm ci from the repository root.
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  set "TAURI_TOOLCHAIN=%TAURI_REPO%\.cache\tauri-toolchain"
  call :load_cached_toolchain
  if errorlevel 1 exit /b 1
)

if not defined CARGO_TARGET_DIR set "CARGO_TARGET_DIR=%TAURI_REPO%\.cache\tauri-target"
if not defined GAMESHARE_CLOUDFLARED if exist "%TAURI_REPO%\tools\cloudflared.exe" set "GAMESHARE_CLOUDFLARED=%TAURI_REPO%\tools\cloudflared.exe"
pushd "%TAURI_REPO%\apps\tauri" || exit /b 1
node "%TAURI_CLI%" %* --target x86_64-pc-windows-msvc
set "TAURI_EXIT=%errorlevel%"
popd
exit /b %TAURI_EXIT%

:load_cached_toolchain
if not exist "%TAURI_TOOLCHAIN%\cargo\bin\cargo.exe" (
  echo Rust Cargo is missing. Install the Rust MSVC toolchain and Windows C++ Build Tools.
  exit /b 1
)
set "CARGO_HOME=%TAURI_TOOLCHAIN%\cargo"
set "RUSTUP_HOME=%TAURI_TOOLCHAIN%\rustup"
set "PATH=%CARGO_HOME%\bin;%PATH%"
set "VCVARS=%TAURI_TOOLCHAIN%\VS Build Tools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" exit /b 0
call "%VCVARS%" >nul
exit /b %errorlevel%
