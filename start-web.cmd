@echo off
rem Starts the local job search interface and opens it in the browser.
rem Pip starts itself again when its code changes (it stops with 75 for that, web/server.ts): this starts it again
rem then, with no second browser tab. If it stops with an error, it is tried again in ten seconds; a clean stop ends it.
cd /d "%~dp0web"
where bun >nul 2>nul
if errorlevel 1 (
  echo Bun was not found. Restart Windows or install it with: winget install Oven-sh.Bun
  pause
  exit /b 1
)
rem Quick when nothing changed, and it brings in packages a newer version of the interface needs.
bun install --ignore-scripts
:run
bun run server.ts
set PIP_CODE=%errorlevel%
if "%PIP_CODE%"=="0" goto done
set JOB_WEB_NO_BROWSER=1
if "%PIP_CODE%"=="75" goto run
echo Pip stopped with an error. Starting it again in ten seconds.
timeout /t 10 /nobreak >nul
goto run
:done
pause
