# Đồng bộ biển VPA cho khobienphongthuy.vn — chạy trên máy Windows của chủ web (mạng Việt Nam).
# Từ 20/10/2026 VPA chặn máy chủ Google/GitHub (lỗi 403) nên sheet BIENSOVP và GitHub không lấy được dữ liệu nữa.
# File này lấy từ VPA: lịch đấu giá + hạn đăng ký + số người ĐK (mỗi ngày) và toàn bộ danh sách biển ô tô (Chủ nhật, hoặc chạy với -Full),
# rồi ghi vào vpa-data/live.json trên GitHub -> web và /admin tự cập nhật.
#
# Chạy tay:  powershell -ExecutionPolicy Bypass -File vpa-sync.ps1          (bình thường)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Full    (lấy lại toàn bộ biển ô tô, ~15-30 phút)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Test    (chạy thử, không đưa lên web)
param([switch]$Full, [switch]$Test)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# ===== CẤU HÌNH =====
$Repo     = 'hieuhhbg2k4-tech/khobienphongthuy'
$Branch   = 'main'
$LiveUrl  = 'https://khobienphongthuy.vn/vpa-data/live.json'
$Api      = 'https://dgbs.vpa.com.vn/search-api/search/list-announcement-plan'
$Days     = 21          # lấy lịch đấu giá trong 21 ngày tới
$Threads  = 3           # số luồng hỏi VPA cùng lúc (nhẹ tay, tránh bị chặn)
$Page     = 25          # VPA chỉ trả 25 biển mỗi lần
$Dir      = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$LogFile  = Join-Path $Dir 'nhat-ky.txt'
$TokenFile= Join-Path $Dir 'github-token.txt'
if ($env:VPA_API) { $Api = $env:VPA_API }; if ($env:GH_BRANCH) { $Branch = $env:GH_BRANCH }; if ($env:LIVE_URL) { $LiveUrl = $env:LIVE_URL }   # chỉ dùng khi kiểm thử

function Log($m) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m
  Write-Host $line
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
}
function Body($date, $site, $offset) {
  '{"offset":' + $offset + ',"limit":' + $Page + ',"province":"","vehicle":"","colorCode":-1,"license_plate":"","auctionDate":"' + $date + '","announcementNumber":"","siteId":' + $site + '}'
}
function Vpa($body) {
  for ($t = 0; $t -lt 4; $t++) {
    try { return Invoke-RestMethod -Uri $Api -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30 -UserAgent 'Mozilla/5.0' }
    catch { if ($t -eq 3) { throw } ; Start-Sleep -Seconds (2 * ($t + 1)) }
  }
}

# Mỗi luồng tự hỏi VPA một phần danh sách; trả về các dòng "biển|ngày đấu|số người ĐK|hạn ĐK"
$Worker = {
  param($bodies, $api)
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($b in $bodies) {
    $ok = $false; $site = [regex]::Match($b, '"siteId":(\d)').Groups[1].Value
    for ($t = 0; $t -lt 4 -and -not $ok; $t++) {
      try {
        $r = Invoke-RestMethod -Uri $api -Method Post -ContentType 'application/json' -Body $b -TimeoutSec 30 -UserAgent 'Mozilla/5.0'
        foreach ($x in $r.content) { $out.Add(('{0}|{1}|{2}|{3}|{4}' -f $x.bks, $x.auctionDate, $x.totalRegisteringPeople, $x.timeEndRegister, $site)) }
        $ok = $true
      } catch { Start-Sleep -Seconds (2 * ($t + 1)) }
    }
    if (-not $ok) { $out.Add('ERR') }
  }
  , $out
}
function FetchMany($bodies) {
  $n = [Math]::Max(1, [Math]::Min($Threads, $bodies.Count))
  $chunks = @(); for ($k = 0; $k -lt $n; $k++) { $chunks += , (New-Object System.Collections.Generic.List[string]) }
  for ($k = 0; $k -lt $bodies.Count; $k++) { $chunks[$k % $n].Add($bodies[$k]) }
  $pool = [runspacefactory]::CreateRunspacePool(1, $n); $pool.Open()
  $jobs = foreach ($c in $chunks) {
    $ps = [powershell]::Create().AddScript($Worker).AddArgument($c.ToArray()).AddArgument($Api)
    $ps.RunspacePool = $pool
    @{ ps = $ps; h = $ps.BeginInvoke() }
  }
  $all = New-Object System.Collections.Generic.List[string]
  foreach ($j in $jobs) { foreach ($res in $j.ps.EndInvoke($j.h)) { foreach ($line in $res) { $all.Add($line) } }; $j.ps.Dispose() }
  $pool.Close()
  , $all
}

try {
  Log ('==== Bắt đầu' + $(if ($Full) { ' (lấy toàn bộ)' } elseif ($Test) { ' (chạy thử)' } else { '' }) + ' ====')
  $vn = (Get-Date).ToUniversalTime().AddHours(7)
  if (-not $Test -and $vn.DayOfWeek -eq 'Sunday' -and $vn.Hour -lt 12) { $Full = $true }   # sáng Chủ nhật: lấy lại toàn bộ biển ô tô

  # 1) Dữ liệu cũ đang có trên web
  $wc = New-Object System.Net.WebClient; $wc.Encoding = [Text.Encoding]::UTF8
  $old = $wc.DownloadString($LiveUrl + '?t=' + [DateTime]::Now.Ticks)
  $rows = New-Object 'System.Collections.Generic.Dictionary[string,object[]]'
  foreach ($m in [regex]::Matches($old, '\[\s*"([0-9A-Z]+)"\s*,\s*(-?\d+|"[^"]*")\s*,\s*(\d)\s*,\s*"([^"]*)"\s*,\s*(-?\d+)\s*\]')) {
    $rows[$m.Groups[1].Value] = @($m.Groups[1].Value, $m.Groups[2].Value, [int]$m.Groups[3].Value, '', [int]$m.Groups[5].Value)
  }
  $provs = '[]'; $pm = [regex]::Match($old, '"provs"\s*:\s*(\[[^\]]*\])'); if ($pm.Success) { $provs = $pm.Groups[1].Value }
  if ($old -notmatch '"src"\s*:\s*"pc"') { $Full = $true }   # lần đầu chạy trên máy -> lấy toàn bộ
  Log ('Dữ liệu cũ trên web: ' + $rows.Count + ' biển')

  # 2) Toàn bộ danh sách biển ô tô (Chủ nhật hoặc -Full)
  if ($Full -and -not $Test) {
    $total = (Vpa (Body '' 1 0)).totalElements
    Log ('VPA đang công bố ' + $total + ' biển ô tô — đang tải toàn bộ...')
    $bodies = New-Object System.Collections.Generic.List[string]
    for ($o = 0; $o -lt $total; $o += $Page) { $bodies.Add((Body '' 1 $o)) }
    $res = FetchMany $bodies.ToArray()
    $err = @($res | Where-Object { $_ -eq 'ERR' }).Count
    $car = New-Object 'System.Collections.Generic.Dictionary[string,object[]]'
    foreach ($l in $res) { if ($l -ne 'ERR') { $p = $l.Split('|'); $cnt = -1; [int]::TryParse($p[2], [ref]$cnt) | Out-Null; $car[$p[0]] = @($p[0], '0', 0, '', $cnt) } }
    if ($car.Count -ge 0.9 * $total) {
      foreach ($k in @($rows.Keys)) { if ($rows[$k][2] -eq 0 -and -not $car.ContainsKey($k)) { $rows.Remove($k) | Out-Null } }   # biển ô tô VPA đã gỡ
      foreach ($k in $car.Keys) { if ($rows.ContainsKey($k)) { $rows[$k][4] = $car[$k][4] } else { $rows[$k] = $car[$k] } }
      Log ('Ô tô: lấy được ' + $car.Count + '/' + $total + ' biển (' + $err + ' lượt lỗi)')
    } else { Log ('Ô tô: chỉ lấy được ' + $car.Count + '/' + $total + ' biển — giữ danh sách cũ') }
  }

  # 3) Lịch đấu giá + hạn đăng ký (ô tô site 1, xe máy site 2)
  $plan = @()
  $last = if ($Test) { 3 } else { $Days }
  for ($k = -1; $k -le $last; $k++) {
    $d = $vn.AddDays($k).ToString('dd/MM/yyyy')
    foreach ($site in 1, 2) {
      $r = Vpa (Body $d $site 0)
      if ($r.totalElements -gt 0) { $plan += , @($d, $site, [int]$r.totalElements); Log ("Phiên $d " + $(if ($site -eq 1) { 'ô tô' } else { 'xe máy' }) + ': ' + $r.totalElements + ' biển') }
    }
  }
  $bodies = New-Object System.Collections.Generic.List[string]
  foreach ($p in $plan) { $lim = if ($Test) { [Math]::Min($p[2], 100) } else { $p[2] }; for ($o = 0; $o -lt $lim; $o += $Page) { $bodies.Add((Body $p[0] $p[1] $o)) } }
  $res = FetchMany $bodies.ToArray()
  $lich = @{}; $regEnd = @{}; $err = 0
  foreach ($l in $res) {
    if ($l -eq 'ERR') { $err++; continue }
    $p = $l.Split('|'); if (-not $p[1]) { continue }
    $lich[$p[0]] = $p
    if ($p[3]) { $dm = $p[1].Split('/'); $regEnd[$dm[2] + $dm[1] + $dm[0]] = $p[3] }
  }
  if ($lich.Count -lt 50 -and -not $Test) { throw ('Chỉ lấy được ' + $lich.Count + ' biển có lịch (' + $err + ' lượt lỗi) — VPA có thể đang chặn, giữ nguyên dữ liệu web') }
  foreach ($k in @($rows.Keys)) { $rows[$k][3] = '' }   # xoá lịch cũ, chỉ giữ lịch VPA đang công bố
  $add = 0
  foreach ($k in $lich.Keys) {
    $p = $lich[$k]; $cnt = -1; [int]::TryParse($p[2], [ref]$cnt) | Out-Null
    if ($rows.ContainsKey($k)) { $rows[$k][3] = $p[1]; if ($cnt -ge 0) { $rows[$k][4] = $cnt } }
    else { $moto = if ($p[4] -eq '2') { 1 } else { 0 }; $rows[$k] = @($k, '0', $moto, $p[1], $cnt); $add++ }
  }
  Log ('Lịch đấu giá: ' + $lich.Count + ' biển có lịch, thêm mới ' + $add + ' biển (' + $err + ' lượt lỗi)')

  # 4) Ghi live.json
  $sb = New-Object System.Text.StringBuilder
  $stamp = $vn.ToString('HH:mm dd/MM/yyyy')
  [void]$sb.Append('{"updated":"' + $stamp + '","src":"pc","lich_updated":"' + $stamp + '","ok":true,"count":' + $rows.Count + ',"provs":' + $provs + ',"reg_end":{')
  $first = $true; foreach ($k in $regEnd.Keys) { if (-not $first) { [void]$sb.Append(',') }; [void]$sb.Append('"' + $k + '":' + $regEnd[$k]); $first = $false }
  [void]$sb.Append('},"rows":[')
  $first = $true
  foreach ($r in $rows.Values) {
    if (-not $first) { [void]$sb.Append(',') }; $first = $false
    [void]$sb.Append('["' + $r[0] + '",' + $r[1] + ',' + $r[2] + ',"' + $r[3] + '",' + $r[4] + ']')
  }
  [void]$sb.Append(']}')
  $json = $sb.ToString()
  $outFile = Join-Path $Dir $(if ($Test) { 'live-thu.json' } else { 'live.json' })
  [IO.File]::WriteAllText($outFile, $json, (New-Object Text.UTF8Encoding $false))
  Log ('Đã ghi ' + $outFile + ' (' + $rows.Count + ' biển, ' + [Math]::Round($json.Length / 1MB, 1) + ' MB)')
  if ($Test) { Log 'Chạy thử xong — chưa đưa lên web.'; exit 0 }

  # 5) Đưa lên GitHub (web tự cập nhật sau 1-2 phút)
  if (-not (Test-Path $TokenFile)) { throw ('Chưa có file ' + $TokenFile + ' chứa mã GitHub') }
  $tok = (Get-Content $TokenFile -Raw).Trim()
  $H = @{ Authorization = 'Bearer ' + $tok; Accept = 'application/vnd.github+json'; 'User-Agent' = 'vpa-sync-khobienphongthuy' }
  $gh = 'https://api.github.com/repos/' + $Repo
  function GH($method, $path, $obj) {
    $b = if ($obj) { [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 5 -Compress)) } else { $null }
    if ($b) { Invoke-RestMethod -Uri ($gh + $path) -Method $method -Headers $H -Body $b -ContentType 'application/json' -TimeoutSec 300 }
    else { Invoke-RestMethod -Uri ($gh + $path) -Method $method -Headers $H -TimeoutSec 120 }
  }
  $ref = GH 'GET' ('/git/ref/heads/' + $Branch) $null
  $base = GH 'GET' ('/git/commits/' + $ref.object.sha) $null
  $blobBody = [Text.Encoding]::UTF8.GetBytes('{"content":"' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)) + '","encoding":"base64"}')
  $blob = Invoke-RestMethod -Uri ($gh + '/git/blobs') -Method Post -Headers $H -Body $blobBody -ContentType 'application/json' -TimeoutSec 600
  $tree = GH 'POST' '/git/trees' @{ base_tree = $base.tree.sha; tree = @(@{ path = 'vpa-data/live.json'; mode = '100644'; type = 'blob'; sha = $blob.sha }) }
  $commit = GH 'POST' '/git/commits' @{ message = ('Cap nhat bien VPA tu may tinh (' + $stamp + ')'); tree = $tree.sha; parents = @($ref.object.sha) }
  GH 'PATCH' ('/git/refs/heads/' + $Branch) @{ sha = $commit.sha } | Out-Null
  try { GH 'POST' '/pages/builds' $null | Out-Null } catch {}
  Log ('Đã đưa lên web: ' + $rows.Count + ' biển, ' + $lich.Count + ' biển có lịch. Xong.')
}
catch {
  Log ('LỖI: ' + $_.Exception.Message)
  exit 1
}
