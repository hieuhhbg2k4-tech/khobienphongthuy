@echo off
cd /d "%~dp0"

python --version >nul 2>&1
if errorlevel 1 (
    echo [LOI] May tinh nay chua cai Python! Hay tai Python tai https://python.org (nho tich Add Python to PATH).
    pause
    exit /b 1
)

python -c "import fastapi, uvicorn, PIL, pyperclip, websockets" >nul 2>&1
if errorlevel 1 (
    echo Dang cai dat cac thu vien can thiet lan dau...
    python -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [LOI] Cai dat thu vien that bai!
        pause
        exit /b 1
    )
)

python server.py --open-host
pause
