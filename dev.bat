@echo off
setlocal
call "%~dp0scripts\tauri.bat" dev
set "STATUS=%errorlevel%"
if not "%STATUS%"=="0" pause
exit /b %STATUS%
