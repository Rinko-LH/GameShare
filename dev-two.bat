@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-clients.ps1" -ClientCount 2
set "STATUS=%errorlevel%"
if not "%STATUS%"=="0" pause
exit /b %STATUS%
