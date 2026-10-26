# Cài lịch chạy tự động: mỗi ngày 9:00 và 15:00 (máy tắt lúc đó thì chạy bù khi bật lại)
$dir = $PSScriptRoot
$ps  = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$file = Join-Path $dir 'vpa-sync.ps1'
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3)
# 9:00: lấy lại toàn bộ danh sách công bố + chính thức (~45-60 phút, VPA giới hạn tốc độ)
$a1 = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $file + '"') -WorkingDirectory $dir
Register-ScheduledTask -TaskName 'VPA Sync khobienphongthuy' -Action $a1 -Trigger (New-ScheduledTaskTrigger -Daily -At 9:00am) -Settings $set -Description 'Lấy toàn bộ danh sách công bố + chính thức VPA, đưa lên khobienphongthuy.vn' -Force | Out-Null
# 15:00: chỉ cập nhật danh sách chính thức (lịch đấu, số người ĐK) (~10 phút)
$a2 = New-ScheduledTaskAction -Execute $ps -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $file + '" -Quick') -WorkingDirectory $dir
Register-ScheduledTask -TaskName 'VPA Sync khobienphongthuy (chieu)' -Action $a2 -Trigger (New-ScheduledTaskTrigger -Daily -At 3:00pm) -Settings $set -Description 'Cập nhật danh sách chính thức VPA lên khobienphongthuy.vn' -Force | Out-Null
Write-Host ''
Write-Host 'Da cai xong: 9:00 lay toan bo, 15:00 cap nhat lich dau.' -ForegroundColor Green
Write-Host 'Xem/tat lich: mo "Task Scheduler", tim "VPA Sync khobienphongthuy".'
