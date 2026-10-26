@echo off
chcp 65001 >nul
echo Cap nhat nhanh danh sach chinh thuc (lich dau) len web...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vpa-sync.ps1" -Quick
pause
