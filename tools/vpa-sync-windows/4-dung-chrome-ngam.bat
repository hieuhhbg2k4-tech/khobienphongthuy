@echo off
echo Tat Chrome chay ngam cua VPA-Sync (khong anh huong Chrome ban dang dung)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe' or Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*remote-debugging-port=9333*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Da tat ' + $_.ProcessId) }"
echo Xong.
timeout /t 5
