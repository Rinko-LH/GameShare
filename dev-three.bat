@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0dev-two.ps1" -ClientCount 3
set "STATUS=%errorlevel%"
if not "%STATUS%"=="0" pause
exit /b %STATUS%
