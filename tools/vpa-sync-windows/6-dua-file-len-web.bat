@echo off
chcp 65001 >nul
echo Dua file live.json co san len web...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vpa-sync.ps1" -UploadOnly
pause
