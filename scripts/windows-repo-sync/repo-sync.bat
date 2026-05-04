@echo off
setlocal

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    python "%~dp0repo-sync.py"
    goto :done
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    py -3 "%~dp0repo-sync.py"
    goto :done
)

echo 未找到 Python。请从 https://www.python.org/downloads/ 安装 Python 3 后再试。
:done
pause
endlocal
