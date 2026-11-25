$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonW = (Get-Command pythonw -ErrorAction Stop).Source
$Cloudflared = (Get-Command cloudflared -ErrorAction Stop).Source
$ServerPy = Join-Path $ScriptDir "server.py"

Write-Host "Dang cai dat tu dong chay ngam (khong can mo PowerShell)..." -ForegroundColor Cyan

# 1. Task cho server.py (chay ngam qua pythonw.exe)
$ActionServer = New-ScheduledTaskAction -Execute $PythonW -Argument "`"$ServerPy`" --domain thehieu04.top" -WorkingDirectory $ScriptDir
$TriggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Days 3650) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName "PCRemote-Server" -Action $ActionServer -Trigger $TriggerLogon -Settings $Settings -Force | Out-Null

# 2. Task cho cloudflared tunnel (chay ngam)
$ActionTunnel = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-WindowStyle Hidden -NoProfile -Command `"& '$Cloudflared' tunnel run pc-remote`"" -WorkingDirectory $ScriptDir
Register-ScheduledTask -TaskName "PCRemote-Tunnel" -Action $ActionTunnel -Trigger $TriggerLogon -Settings $Settings -Force | Out-Null

# Khoi chay ngay lap tuc
Stop-ScheduledTask -TaskName "PCRemote-Tunnel" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName "PCRemote-Tunnel"

# Neu port 8765 dang ban boi server cu, giu nguyen hoac khoi dong neu chua chay
$listening = Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
    Start-ScheduledTask -TaskName "PCRemote-Server"
}

Write-Host "`n=== HOAN TAT! ===" -ForegroundColor Green
Write-Host "Tu gio moi lan bat may tinh, he thong se TU DONG CHAY NGAM." -ForegroundColor Cyan
Write-Host "Ban khong can mo PowerShell nua, chi can mo https://thehieu04.top tren dien thoai!" -ForegroundColor Cyan

