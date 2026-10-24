@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Oxkio.ps1" %*
set "OXKIO_EXIT_CODE=%ERRORLEVEL%"
if not "%OXKIO_EXIT_CODE%"=="0" (
  echo.
  echo [OXKIO] El servidor ha terminado con error %OXKIO_EXIT_CODE%.
  echo [OXKIO] Esta ventana se conserva para que puedas ver el diagnostico.
  pause
)
exit /b %OXKIO_EXIT_CODE%
