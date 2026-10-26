@echo off
chcp 65001 >nul
echo Dang lay bien VPA va dua len web (lan dau mat 10-20 phut)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vpa-sync.ps1"
pause
