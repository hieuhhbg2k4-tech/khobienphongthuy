$ErrorActionPreference = "Stop"
$Domain = "thehieu04.top"
$TunnelName = "pc-remote"
$CfDir = Join-Path $env:USERPROFILE ".cloudflared"

Write-Host "=== CAI DAT TEN MIEN $Domain VOI CLOUDFLARE TUNNEL ===" -ForegroundColor Cyan

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "Chua tim thay cloudflared.exe!" -ForegroundColor Red
    exit 1
}

if (-not (Test-Path (Join-Path $CfDir "cert.pem"))) {
    Write-Host "`n[1/4] Dang nhap Cloudflare (trinh duyet se mo len, hay chon domain $Domain)..." -ForegroundColor Yellow
    cloudflared tunnel login
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "`n[1/4] Da co cert.pem Cloudflare." -ForegroundColor Green
}

Write-Host "`n[2/4] Kiem tra / tao tunnel '$TunnelName'..." -ForegroundColor Yellow
$tunnels = @(cloudflared tunnel list --output json | ConvertFrom-Json)
$existing = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
if (-not $existing) {
    cloudflared tunnel create $TunnelName
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $tunnels = @(cloudflared tunnel list --output json | ConvertFrom-Json)
    $existing = $tunnels | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
}
$TunnelId = "$($existing.id)".Trim()
$CredFile = Join-Path $CfDir "$TunnelId.json"
Write-Host "Tunnel ID: $TunnelId" -ForegroundColor Green

Write-Host "`n[3/4] Tro DNS $Domain -> tunnel '$TunnelName'..." -ForegroundColor Yellow
cloudflared tunnel route dns $TunnelName $Domain

Write-Host "`n[4/4] Ghi file cau hinh $CfDir\config.yml..." -ForegroundColor Yellow
$ConfigContent = @"
tunnel: $TunnelId
credentials-file: $CredFile

ingress:
  - hostname: $Domain
    service: http://127.0.0.1:8765
  - service: http_status:404
"@
Set-Content -Path (Join-Path $CfDir "config.yml") -Value $ConfigContent -Encoding UTF8

Write-Host "`n=== HOAN TAT! ===" -ForegroundColor Green
Write-Host "Bay gio hay chay file: start_thehieu04.bat" -ForegroundColor Cyan
Write-Host "Sau do mo Chrome tren dien thoai vao: https://$Domain" -ForegroundColor Cyan

