@echo off
chcp 65001 >nul
echo Cap nhat Danh sach bien cong bo VPA len web...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vpa-sync.ps1" -Published
pause
