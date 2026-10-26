@echo off
chcp 65001 >nul
echo Chay thu (khong dua len web)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vpa-sync.ps1" -Test
pause
