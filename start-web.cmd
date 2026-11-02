@echo off
rem Starts the local job search interface and opens it in the browser.
cd /d "%~dp0web"
where bun >nul 2>nul
if errorlevel 1 (
  echo Bun was not found. Restart Windows or install it with: winget install Oven-sh.Bun
  pause
  exit /b 1
)
rem Quick when nothing changed, and it brings in packages a newer version of the interface needs.
bun install --ignore-scripts
bun run server.ts
pause
