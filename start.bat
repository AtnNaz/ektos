@echo off
title Ektos server
cd /d "%~dp0"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/"

if not exist ".venv\Scripts\python.exe" goto novenv

curl.exe -s -f -o nul -m 2 "%URL%api/meter" >nul 2>&1
if not errorlevel 1 goto already

if not defined EKTOS_NO_BROWSER start "" /b powershell -NoProfile -Command "$u='%URL%'; for($i=0;$i -lt 120;$i++){ try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 ($u+'api/meter') | Out-Null; Start-Process $u; break } catch { Start-Sleep -Milliseconds 250 } }"

echo.
echo   Starting the Ektos server: %URL%
echo   The page opens in your browser when it is ready.
echo   Close this window to stop the server.
echo.
".venv\Scripts\python.exe" -m ektos.server --port %PORT%
if errorlevel 1 goto failed
exit /b 0

:already
echo.
echo   The Ektos server is already running: %URL%
echo   Opening the page in your browser.
if not defined EKTOS_NO_BROWSER start "" "%URL%"
timeout /t 5 >nul
exit /b 0

:novenv
echo.
echo   The .venv folder was not found, so the Python environment is not set up.
echo   Run these two commands once in this folder:
echo     python -m venv .venv
echo     .venv\Scripts\python -m pip install -r requirements.txt
echo.
pause
exit /b 1

:failed
echo.
echo   The server could not start or stopped with an error. See the message above.
echo   Another program may be using port %PORT%.
echo.
pause
exit /b 1
