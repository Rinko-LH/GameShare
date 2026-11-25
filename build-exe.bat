@echo off
setlocal
call "%~dp0scripts\tauri.bat" build --no-bundle
set "STATUS=%errorlevel%"
pause
exit /b %STATUS%
