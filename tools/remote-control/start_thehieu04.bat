@echo off
cd /d "%~dp0"

if not exist "%USERPROFILE%\.cloudflared\config.yml" (
    echo Chua cau hinh ten mien thehieu04.top!
    echo Dang chay trinh cai dat setup_domain.ps1...
    powershell -ExecutionPolicy Bypass -File "%~dp0setup_domain.ps1"
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

echo Dang khoi dong Cloudflare Tunnel (thehieu04.top)...
start "Cloudflare Tunnel - thehieu04.top" cmd /c "cloudflared tunnel run pc-remote"

python server.py --domain thehieu04.top --open-host
pause

