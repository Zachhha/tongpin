@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
  goto :end
)

set "BUNDLED_NODE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
if exist "%BUNDLED_NODE%" (
  "%BUNDLED_NODE%" server.js
  goto :end
)

echo.
echo 没有找到 Node.js。请安装 Node.js 18 或更高版本，或从 DSH 的运行时启动。
echo.
pause

:end
if errorlevel 1 pause
