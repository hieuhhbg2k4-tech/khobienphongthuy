Stop-ScheduledTask -TaskName "PCRemote-Server" -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName "PCRemote-Tunnel" -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "PCRemote-Server" -Confirm:$false -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName "PCRemote-Tunnel" -Confirm:$false -ErrorAction SilentlyContinue
Write-Host "Da go bo tu dong chay ngam PCRemote-Server va PCRemote-Tunnel." -ForegroundColor Yellow

