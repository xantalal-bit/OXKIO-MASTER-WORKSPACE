@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Oxkio.ps1" %*
exit /b %ERRORLEVEL%
