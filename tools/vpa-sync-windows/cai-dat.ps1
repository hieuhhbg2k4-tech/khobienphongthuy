# Cài lịch chạy tự động: mỗi ngày 9:00 và 15:00 (máy tắt lúc đó thì chạy bù khi bật lại)
$dir = $PSScriptRoot
$ps  = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$act = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $dir 'vpa-sync.ps1') + '"') -WorkingDirectory $dir
$tr  = @((New-ScheduledTaskTrigger -Daily -At 9:00am), (New-ScheduledTaskTrigger -Daily -At 3:00pm))
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName 'VPA Sync khobienphongthuy' -Action $act -Trigger $tr -Settings $set -Description 'Lấy biển + lịch đấu giá VPA, đưa lên khobienphongthuy.vn' -Force | Out-Null
Write-Host ''
Write-Host 'Da cai xong lich chay tu dong: moi ngay 9:00 va 15:00.' -ForegroundColor Green
Write-Host 'Xem/tat lich: mo "Task Scheduler", tim "VPA Sync khobienphongthuy".'
