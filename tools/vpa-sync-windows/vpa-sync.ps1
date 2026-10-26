# Đồng bộ biển VPA cho khobienphongthuy.vn — chạy trên máy Windows của chủ web (mạng Việt Nam).
# Từ 20/10/2026 VPA chặn máy chủ Google/GitHub (lỗi 403) nên sheet BIENSOVP và GitHub không lấy được dữ liệu nữa.
# File này lấy từ VPA cả Danh sách công bố (toàn bộ ô tô + xe máy) và Danh sách chính thức (lịch đấu, hạn ĐK, số người ĐK),
# rồi ghi vào vpa-data/live.json trên GitHub -> web và /admin tự cập nhật.
#
# Chạy tay:  powershell -ExecutionPolicy Bypass -File vpa-sync.ps1          (bình thường)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Quick   (chỉ cập nhật lịch đấu, vài phút)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Test    (chạy thử, không đưa lên web)
param([switch]$Quick, [switch]$Test)
# Mặc định mỗi lần chạy lấy LẠI TOÀN BỘ cả 2 danh sách để web khớp VPA (VPA gỡ biển nào thì web gỡ biển đó).
$Full = -not $Quick

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# ===== CẤU HÌNH =====
$Repo     = 'hieuhhbg2k4-tech/khobienphongthuy'
$Branch   = 'main'
$LiveUrl  = 'https://khobienphongthuy.vn/vpa-data/live.json'
$Days     = 21          # lấy lịch đấu giá trong 21 ngày tới
$Threads  = 5           # số yêu cầu Chrome gửi cùng lúc (nhẹ tay, tránh bị chặn)
$Page     = 25          # VPA chỉ trả 25 biển mỗi lần
$Dir      = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$LogFile  = Join-Path $Dir 'nhat-ky.txt'
$TokenFile= Join-Path $Dir 'github-token.txt'
if ($env:GH_BRANCH) { $Branch = $env:GH_BRANCH }; if ($env:LIVE_URL) { $LiveUrl = $env:LIVE_URL }   # chỉ dùng khi kiểm thử

function Log($m) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $m
  Write-Host $line
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
}
# ===== Hỏi VPA qua Chrome chạy ngầm =====
# VPA chặn mọi chương trình không phải trình duyệt thật (lỗi 403), nên file này mở Chrome ẩn (không hiện cửa sổ),
# vào trang dgbs.vpa.com.vn rồi để chính Chrome hỏi dữ liệu — giống người dùng mở trang web.
$VpaHome = if ($env:VPA_HOME) { $env:VPA_HOME } else { 'https://dgbs.vpa.com.vn/' }
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'
$script:cid = 0; $script:ws = $null; $script:chrome = $null
function JsonEsc($t) { $t.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '\n') }
function Start-Chrome {
  $cands = @($env:CHROME_EXE)
  foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) { if ($base) { $cands += (Join-Path $base 'Google\Chrome\Application\chrome.exe') } }
  if (${env:ProgramFiles(x86)}) { $cands += (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe') }
  $cands = @($cands | Where-Object { $_ -and (Test-Path $_) })
  if (-not $cands) { throw 'Không tìm thấy Chrome hoặc Edge trên máy' }
  $port = 9333; $prof = Join-Path $Dir 'chrome-profile'
  $a = @('--headless=new', "--remote-debugging-port=$port", ('--user-data-dir="' + $prof + '"'), '--no-first-run', '--no-default-browser-check', '--disable-gpu', ('--user-agent="' + $UA + '"'), $VpaHome)
  if ($env:CHROME_EXTRA) { $a = @($env:CHROME_EXTRA.Split(' ')) + $a }
  if ($env:OS -eq 'Windows_NT') { $script:chrome = Start-Process -FilePath $cands[0] -ArgumentList $a -PassThru -WindowStyle Hidden }
  else { $script:chrome = Start-Process -FilePath $cands[0] -ArgumentList $a -PassThru }
  $wsUrl = $null
  for ($t = 0; $t -lt 60 -and -not $wsUrl; $t++) {
    Start-Sleep -Milliseconds 500
    try { $list = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 3; $pg = @($list | Where-Object { $_.type -eq 'page' })[0]; if ($pg) { $wsUrl = $pg.webSocketDebuggerUrl } } catch {}
  }
  if (-not $wsUrl) { throw 'Không mở được Chrome chạy ngầm' }
  $script:ws = New-Object System.Net.WebSockets.ClientWebSocket
  $script:ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(20)
  $script:ws.ConnectAsync([Uri]$wsUrl, [Threading.CancellationToken]::None).Wait()
  for ($t = 0; $t -lt 60; $t++) { if ((Eval 'location.host + "|" + document.readyState') -match 'vpa|127\.0\.0\.1.*\|complete') { break }; Start-Sleep -Seconds 1 }
  Start-Sleep -Seconds 3
}
function Cdp($method, $paramsJson) {
  $script:cid++
  $bytes = [Text.Encoding]::UTF8.GetBytes('{"id":' + $script:cid + ',"method":"' + $method + '","params":' + $paramsJson + '}')
  $script:ws.SendAsync((New-Object 'ArraySegment[byte]' -ArgumentList @(, $bytes)), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
  $buf = New-Object byte[] 1048576
  while ($true) {
    $ms = New-Object IO.MemoryStream
    do { $r = $script:ws.ReceiveAsync((New-Object 'ArraySegment[byte]' -ArgumentList @(, $buf)), [Threading.CancellationToken]::None).GetAwaiter().GetResult(); $ms.Write($buf, 0, $r.Count) } while (-not $r.EndOfMessage)
    $txt = [Text.Encoding]::UTF8.GetString($ms.ToArray())
    if ($txt.StartsWith('{"id":' + $script:cid + ',')) { return $txt }
  }
}
function Eval($expr) {
  $res = Cdp 'Runtime.evaluate' ('{"expression":"' + (JsonEsc $expr) + '","awaitPromise":true,"returnByValue":true}')
  $m = [regex]::Match($res, '"value":"([^"]*)"')
  if ($m.Success) { return $m.Groups[1].Value }
  if ($res -match '"exceptionDetails"') { throw ('Chrome báo lỗi: ' + $res.Substring(0, [Math]::Min(300, $res.Length))) }
  return ''
}
function Stop-Chrome { try { if ($script:ws) { $script:ws.Dispose() } } catch {}; try { if ($script:chrome -and -not $script:chrome.HasExited) { Stop-Process -Id $script:chrome.Id -Force } } catch {}
  try { Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*remote-debugging-port=9333*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } } catch {} }

# Hàm chạy trong Chrome: plan = "ngày|site|tổng;..."  -> trả "biển|ngày đấu|số người ĐK|hạn ĐK|site;..."
$JsFn = @'
(async (planText, conc, probeOnly) => {
  const api = '/search-api/search/list-announcement-plan';
  const body = (d, s, o, p) => JSON.stringify({ offset: o, limit: 25, province: p || '', vehicle: '', colorCode: -1, license_plate: '', auctionDate: d, announcementNumber: '', siteId: +s });
  const post = async (d, s, o, p) => { for (let t = 0; t < 4; t++) { try { const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(d, s, o, p) }); if (r.ok) return await r.json(); } catch (e) {} await new Promise(z => setTimeout(z, 1500 * (t + 1))); } return null; };
  const items = planText.split(';').filter(Boolean).map(x => x.split('|'));
  if (probeOnly) { const out = []; for (const [d, s] of items) { const j = await post(d, s, 0); out.push(d + '|' + s + '|' + (j ? (j.totalElements || 0) : -1)); } return out.join(';'); }
  // VPA trả rất chậm khi offset lớn (trang sâu) -> danh sách lớn thì chia theo tỉnh (mã 01..99) để trang nào cũng gần đầu
  const tasks = [];
  for (const [d, s, tot] of items) {
    if (+tot > 20000) {
      const tots = []; for (let k = 1; k <= 99; k++) { const c = String(k).padStart(2, '0'); const j = await post(d, s, 0, c); if (j && j.totalElements) tots.push([c, j.totalElements]); }
      const sum = tots.reduce((a, b) => a + b[1], 0);
      if (sum >= 0.98 * +tot) { for (const [c, n] of tots) for (let o = 0; o < n; o += 25) tasks.push([d, s, o, c]); continue; }
    }
    for (let o = 0; o < +tot; o += 25) tasks.push([d, s, o, '']);
  }
  const out = []; let i = 0;
  const w = async () => { while (i < tasks.length) { const [d, s, o, pv] = tasks[i++]; const j = await post(d, s, o, pv); if (!j) { out.push('ERR'); continue; }
    for (const x of (j.content || [])) out.push(x.bks + '|' + (x.auctionDate || '') + '|' + (x.totalRegisteringPeople == null ? '' : x.totalRegisteringPeople) + '|' + (x.timeEndRegister || '') + '|' + s); } };
  await Promise.all(Array.from({ length: conc }, w));
  return out.join(';');
})
'@
# Danh sách chính thức (trang "Danh sách chính thức" / Đăng ký đấu giá trên VPA): biển đã có lịch đấu, giờ đấu, hạn đăng ký
$JsOfficial = @'
(async (sites, conc, cap) => {
  const api = '/api/bidding/public-result/list-await-auction/customer/detail';
  const body = (s, p) => JSON.stringify({ provinceId: '', districtId: '', page: p, limit: 25, search: '', typeVehicle: '', siteId: s, colorCode: -1, fromAuctionTime: '', toAuctionTime: '' });
  const post = async (s, p) => { for (let t = 0; t < 4; t++) { try { const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(s, p) }); if (r.ok) return await r.json(); } catch (e) {} await new Promise(z => setTimeout(z, 1500 * (t + 1))); } return null; };
  const vn = iso => { const d = new Date(new Date(iso).getTime() + 7 * 3600e3); const z = n => String(n).padStart(2, '0'); return z(d.getUTCDate()) + '/' + z(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear(); };
  const tasks = [], info = [];
  for (const s of sites) { const j = await post(s, 1); const tot = j ? (j.totalElements || 0) : -1; info.push('#' + s + '|' + tot); let pages = Math.ceil(Math.max(0, tot) / 25); if (cap) pages = Math.min(pages, cap); for (let p = 1; p <= pages; p++) tasks.push([s, p]); }
  const out = []; let i = 0;
  const w = async () => { while (i < tasks.length) { const [s, p] = tasks[i++]; const j = await post(s, p); if (!j) { out.push('ERR'); continue; }
    for (const x of (j.data || [])) { if (!x.plateNumber || !x.auctionFromTime) continue;
      out.push(x.plateNumber + '|' + vn(x.auctionFromTime) + '|' + (x.totalRegisteringPeople == null ? '' : x.totalRegisteringPeople) + '|' + (x.registerToDate ? new Date(x.registerToDate).getTime() : '') + '|' + s); } } };
  await Promise.all(Array.from({ length: conc }, w));
  return info.concat(out).join(';');
})
'@
function FetchOfficial($cap) {   # -> @{ total = @{site=tổng}; lines = List }
  $out = New-Object System.Collections.Generic.List[string]; $tot = @{}
  foreach ($l in (Eval ($JsOfficial + "([1,2]," + $Threads + "," + $cap + ")")).Split(';')) { if (-not $l) { continue }; if ($l.StartsWith('#')) { $p = $l.Substring(1).Split('|'); $tot[$p[0]] = [int]$p[1] } else { $out.Add($l) } }
  @{ total = $tot; lines = $out }
}
function Probe($specs) {   # specs: @("ngày|site", ...) -> @{ "ngày|site" = tổng }
  $r = @{}; foreach ($x in (Eval ($JsFn + "('" + ($specs -join ';') + "',1,true)")).Split(';')) { if ($x) { $p = $x.Split('|'); $r[$p[0] + '|' + $p[1]] = [int]$p[2] } }; $r
}
function FetchPlan($plan) {   # plan: @(@(ngày, site, tổng), ...) -> List các dòng
  $txt = ($plan | ForEach-Object { $_[0] + '|' + $_[1] + '|' + $_[2] }) -join ';'
  $out = New-Object System.Collections.Generic.List[string]
  foreach ($l in (Eval ($JsFn + "('" + $txt + "'," + $Threads + ",false)")).Split(';')) { if ($l) { $out.Add($l) } }
  , $out
}

try {
  Log ('==== Bắt đầu' + $(if ($Test) { ' (chạy thử)' } elseif ($Quick) { ' (chỉ lịch đấu)' } else { ' (cả danh sách công bố + chính thức)' }) + ' ====')
  $vn = (Get-Date).ToUniversalTime().AddHours(7)

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
  Stop-Chrome   # tắt Chrome ngầm còn sót từ lần chạy trước (nếu có)
  Start-Chrome
  Log 'Đã mở Chrome chạy ngầm, đang hỏi VPA...'

  # 2) Danh sách công bố: toàn bộ biển ô tô (site 1) và xe máy (site 2) — mỗi lần chạy (trừ -Quick / -Test)
  if ($Full -and -not $Test) {
    foreach ($site in 1, 2) {
      $ten = if ($site -eq 1) { 'ô tô' } else { 'xe máy' }; $moto = $site - 1
      $total = (Probe @('|' + $site))['|' + $site]
      if ($total -le 0) { Log ('Danh sách công bố ' + $ten + ': VPA không trả về tổng số — bỏ qua'); continue }
      Log ('Danh sách công bố ' + $ten + ': ' + $total + ' biển — đang tải toàn bộ...')
      $res = FetchPlan @(, @('', $site, $total))
      $err = @($res | Where-Object { $_ -eq 'ERR' }).Count
      $got = New-Object 'System.Collections.Generic.Dictionary[string,object[]]'
      foreach ($l in $res) { if ($l -ne 'ERR') { $p = $l.Split('|'); $cnt = -1; [int]::TryParse($p[2], [ref]$cnt) | Out-Null; $got[$p[0]] = @($p[0], '0', $moto, '', $cnt) } }
      if ($got.Count -ge 0.9 * $total) {
        foreach ($k in @($rows.Keys)) { if ($rows[$k][2] -eq $moto -and -not $got.ContainsKey($k)) { $rows.Remove($k) | Out-Null } }   # biển VPA đã gỡ
        foreach ($k in $got.Keys) { if ($rows.ContainsKey($k)) { $rows[$k][4] = $got[$k][4] } else { $rows[$k] = $got[$k] } }
        Log ('Danh sách công bố ' + $ten + ': lấy được ' + $got.Count + '/' + $total + ' biển (' + $err + ' lượt lỗi)')
      } else { Log ('Danh sách công bố ' + $ten + ': chỉ lấy được ' + $got.Count + '/' + $total + ' — giữ danh sách cũ') }
    }
  }

  # 3) Danh sách chính thức: biển có lịch đấu + hạn đăng ký + số người ĐK (ô tô + xe máy)
  $lich = @{}; $regEnd = @{}; $err = 0
  $off = FetchOfficial $(if ($Test) { 4 } else { 0 })
  foreach ($k in $off.total.Keys) { Log ('Danh sách chính thức ' + $(if ($k -eq '1') { 'ô tô' } else { 'xe máy' }) + ': ' + $off.total[$k] + ' biển') }
  foreach ($l in $off.lines) {
    if ($l -eq 'ERR') { $err++; continue }
    $p = $l.Split('|'); if (-not $p[1]) { continue }
    $lich[$p[0]] = $p
    if ($p[3]) { $dm = $p[1].Split('/'); $regEnd[$dm[2] + $dm[1] + $dm[0]] = $p[3] }
  }
  if ($lich.Count -lt 50 -and -not $Test) {
    Log ('Danh sách chính thức chỉ lấy được ' + $lich.Count + ' biển — lấy lịch từ danh sách công bố theo ngày')
    # 3) Lịch đấu giá + hạn đăng ký (ô tô site 1, xe máy site 2)
    $plan = @(); $specs = @()
    $last = if ($Test) { 3 } else { $Days }
    for ($k = -1; $k -le $last; $k++) { $d = $vn.AddDays($k).ToString('dd/MM/yyyy'); $specs += ($d + '|1'); $specs += ($d + '|2') }
    $tot = Probe $specs
    if (@($tot.Values | Where-Object { $_ -lt 0 }).Count -eq $tot.Count) { throw 'VPA không trả lời (có thể đang chặn)' }
    foreach ($sp in $specs) { $n = $tot[$sp]; if ($n -gt 0) { $p = $sp.Split('|'); if ($Test) { $n = [Math]::Min($n, 100) }; $plan += , @($p[0], [int]$p[1], $n)
        Log ('Phiên ' + $p[0] + ' ' + $(if ($p[1] -eq '1') { 'ô tô' } else { 'xe máy' }) + ': ' + $tot[$sp] + ' biển') } }
    $res = if ($plan.Count) { FetchPlan $plan } else { New-Object System.Collections.Generic.List[string] }
    foreach ($l in $res) {
      if ($l -eq 'ERR') { $err++; continue }
      $p = $l.Split('|'); if (-not $p[1]) { continue }
      $lich[$p[0]] = $p
      if ($p[3]) { $dm = $p[1].Split('/'); $regEnd[$dm[2] + $dm[1] + $dm[0]] = $p[3] }
    }
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

  Stop-Chrome

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
finally { Stop-Chrome }
