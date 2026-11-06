@echo off
chcp 65001 >nul
echo Cap nhat Kho bien so VPA (o to + xe may) len web...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vpa-sync.ps1" -Warehouse
pause
