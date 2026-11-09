@echo off
setlocal enabledelayedexpansion

REM Resolve portable USB / project root relative to this batch script
set "APP_ROOT=%~dp0"
cd /d "%APP_ROOT%"

if not exist "%APP_ROOT%secrets" mkdir "%APP_ROOT%secrets"
if not exist "%APP_ROOT%data" mkdir "%APP_ROOT%data"

echo ==========================================================
echo   Accounts Dues Manager - Portable Encrypted USB Terminal
echo   Root: %APP_ROOT%
echo ==========================================================

set "NODE_OPTIONS=--no-warnings"

REM Locate Node.js executable (bundled portable node in bin\windows\node.exe or system node)
if exist "%APP_ROOT%bin\windows\node.exe" (
  set "NODE_EXE=%APP_ROOT%bin\windows\node.exe"
) else (
  where node >nul 2>&1
  if errorlevel 1 (
    echo.
    echo [Error] Node.js is not found on your system.
    echo Please install Node.js ^(v22+^) from https://nodejs.org or place node.exe into bin\windows\node.exe on this drive.
    echo.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

set "PORT=3003"
set "ADM_ROOT_DIR=%APP_ROOT%"

REM Open default browser to the application
start "" "http://localhost:3003"

if exist "%APP_ROOT%frontend\node_modules\next" (
  echo [Mode] Launching Next.js Frontend + Encrypted SQLite Service...
  call npm --prefix "%APP_ROOT%frontend" run dev
) else (
  echo [Mode] Launching Standalone Portable Server w/ Embedded UI ^& Encrypted SQLite...
  "%NODE_EXE%" --no-warnings "%APP_ROOT%backend\src\server.ts"
)

echo [USB Safe Shutdown] Encrypted SQLite WAL flushed and closed.
endlocal

