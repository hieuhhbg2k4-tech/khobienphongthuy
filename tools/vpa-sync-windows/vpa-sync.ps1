# Đồng bộ biển VPA cho khobienphongthuy.vn — chạy trên máy Windows của chủ web (mạng Việt Nam).
# Từ 20/10/2026 VPA chặn máy chủ Google/GitHub (lỗi 403) nên sheet BIENSOVP và GitHub không lấy được dữ liệu nữa.
# File này lấy từ VPA cả Danh sách công bố (toàn bộ ô tô + xe máy) và Danh sách chính thức (lịch đấu, hạn ĐK, số người ĐK),
# rồi ghi vào vpa-data/live.json trên GitHub -> web và /admin tự cập nhật.
#
# Chạy tay:  powershell -ExecutionPolicy Bypass -File vpa-sync.ps1          (bình thường)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Quick   (chỉ cập nhật lịch đấu, vài phút)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Test    (chạy thử, không đưa lên web)
param([switch]$Quick, [switch]$Test, [switch]$UploadOnly)
# Mặc định mỗi lần chạy lấy LẠI TOÀN BỘ cả 2 danh sách để web khớp VPA (VPA gỡ biển nào thì web gỡ biển đó).
$Full = -not $Quick

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# ===== CẤU HÌNH =====
$Repo     = 'hieuhhbg2k4-tech/khobienphongthuy'
$Branch   = 'main'
$LiveUrl  = 'https://khobienphongthuy.vn/vpa-data/live.json'
$Days     = 21          # lấy lịch đấu giá trong 21 ngày tới
$Threads  = 2           # số yêu cầu gửi cùng lúc — VPA giới hạn tốc độ (lỗi 429 nếu hỏi dồn), 2 là mức an toàn đã thử
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
  const post = async (d, s, o, p) => { for (let t = 0; t < 12; t++) { let st = 0; try { const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(d, s, o, p) }); st = r.status; if (r.ok) return await r.json(); } catch (e) {} await new Promise(z => setTimeout(z, st === 429 ? 30000 : 2000 * (t + 1))); } return null; };   // 429 = VPA bảo hỏi chậm lại -> chờ 30 giây
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
  const post = async (s, p) => { for (let t = 0; t < 12; t++) { let st = 0; try { const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(s, p) }); st = r.status; if (r.ok) return await r.json(); } catch (e) {} await new Promise(z => setTimeout(z, st === 429 ? 30000 : 2000 * (t + 1))); } return null; };
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

# Ghi live.json + đưa lên web. Gọi sau MỖI bước để web có dữ liệu mới ngay (cập nhật đến đâu lên web đến đó)
$script:regEnd = @{}; $script:nLich = 0
function Publish($buoc) {
  $sb = New-Object System.Text.StringBuilder
  $stamp = (Get-Date).ToUniversalTime().AddHours(7).ToString('HH:mm dd/MM/yyyy')
  [void]$sb.Append('{"updated":"' + $stamp + '","src":"pc","lich_updated":"' + $stamp + '","ok":true,"count":' + $rows.Count + ',"provs":' + $provs + ',"reg_end":{')
  $first = $true; foreach ($k in $script:regEnd.Keys) { if (-not $first) { [void]$sb.Append(',') }; [void]$sb.Append('"' + $k + '":' + $script:regEnd[$k]); $first = $false }
  [void]$sb.Append('},"rows":[')
  $first = $true
  foreach ($r in $rows.Values) { if (-not $first) { [void]$sb.Append(',') }; $first = $false; [void]$sb.Append('["' + $r[0] + '",' + $r[1] + ',' + $r[2] + ',"' + $r[3] + '",' + $r[4] + ']') }
  [void]$sb.Append(']}')
  $json = $sb.ToString()
  $outFile = Join-Path $Dir $(if ($Test) { 'live-thu.json' } else { 'live.json' })
  [IO.File]::WriteAllText($outFile, $json, (New-Object Text.UTF8Encoding $false))
  if ($env:SKIP_UPLOAD) { Log ('[' + $buoc + '] (kiểm thử) ' + $rows.Count + ' biển'); return }
  if ($Test) { Log ('[' + $buoc + '] Đã ghi ' + $outFile + ' (' + $rows.Count + ' biển) — chạy thử, không đưa lên web'); return }
  Upload $json $buoc $stamp
  Log ('[' + $buoc + '] ĐÃ ĐƯA LÊN WEB: ' + $rows.Count + ' biển, ' + $script:nLich + ' biển có lịch')
}
function Upload($json, $buoc, $stamp) {
  if (-not (Test-Path $TokenFile)) { throw ('Chưa có file ' + $TokenFile + ' chứa mã GitHub') }
  $tok = (Get-Content $TokenFile -Raw).Trim()
  $H = @{ Authorization = 'Bearer ' + $tok; Accept = 'application/vnd.github+json'; 'User-Agent' = 'vpa-sync-khobienphongthuy' }
  $gh = 'https://api.github.com/repos/' + $Repo
  $U8 = [Text.Encoding]::UTF8   # tự viết JSON; truyền thẳng mảng byte (không qua scriptblock để PowerShell không tách mảng)
  $step = 'đọc nhánh'
  try {
  $ref = Invoke-RestMethod -Uri ($gh + '/git/ref/heads/' + $Branch) -Headers $H -TimeoutSec 120
  $base = Invoke-RestMethod -Uri ($gh + '/git/commits/' + $ref.object.sha) -Headers $H -TimeoutSec 120
  $blobBody = [Text.Encoding]::UTF8.GetBytes('{"content":"' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)) + '","encoding":"base64"}')
  $step = 'tải file lên'
  $blob = Invoke-RestMethod -Uri ($gh + '/git/blobs') -Method Post -Headers $H -Body $blobBody -ContentType 'application/json' -TimeoutSec 600
  $step = 'tạo cây thư mục'
  $tree = Invoke-RestMethod -Uri ($gh + '/git/trees') -Method Post -Headers $H -ContentType 'application/json' -TimeoutSec 300 -Body ($U8.GetBytes('{"base_tree":"' + $base.tree.sha + '","tree":[{"path":"vpa-data/live.json","mode":"100644","type":"blob","sha":"' + $blob.sha + '"}]}'))
  $step = 'tạo commit'
  $commit = Invoke-RestMethod -Uri ($gh + '/git/commits') -Method Post -Headers $H -ContentType 'application/json' -TimeoutSec 300 -Body ($U8.GetBytes('{"message":"Cap nhat bien VPA tu may tinh: ' + $buoc + ' (' + $stamp + ')","tree":"' + $tree.sha + '","parents":["' + $ref.object.sha + '"]}'))
  $step = 'cập nhật nhánh'
  Invoke-RestMethod -Uri ($gh + '/git/refs/heads/' + $Branch) -Method Patch -Headers $H -ContentType 'application/json' -TimeoutSec 120 -Body ($U8.GetBytes('{"sha":"' + $commit.sha + '"}')) | Out-Null
  } catch { $msg = $_.Exception.Message; if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg += ' | ' + $_.ErrorDetails.Message }; throw ('GitHub lỗi ở bước ' + $step + ': ' + $msg) }
  try { Invoke-RestMethod -Uri ($gh + '/pages/builds') -Method Post -Headers $H -TimeoutSec 60 | Out-Null } catch {}
}


try {
  Log ('==== Bắt đầu' + $(if ($Test) { ' (chạy thử)' } elseif ($Quick) { ' (chỉ lịch đấu)' } else { ' (cả danh sách công bố + chính thức)' }) + ' ====')
  $vn = (Get-Date).ToUniversalTime().AddHours(7)
  if ($UploadOnly) {   # chỉ đưa file live.json đã tải sẵn trên máy lên web
    $f = Join-Path $Dir 'live.json'; $json = [IO.File]::ReadAllText($f, [Text.Encoding]::UTF8)
    Upload $json 'dua file co san' $vn.ToString('HH:mm dd/MM/yyyy')
    Log ('ĐÃ ĐƯA LÊN WEB file có sẵn (' + [Math]::Round($json.Length / 1MB, 1) + ' MB)'); exit 0
  }

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

  # 2) Danh sách chính thức trước (nhanh): biển có lịch đấu + hạn đăng ký + số người ĐK (ô tô + xe máy)
  #    Lấy theo từng ngày đấu trong danh sách VPA (trang "Danh sách chính thức" của VPA xáo trộn thứ tự khi lật trang nên bị trùng/thiếu)
  $lich = @{}; $err = 0
  $plan = @(); $specs = @()
  $last = if ($Test) { 3 } else { $Days }
  for ($k = -1; $k -le $last; $k++) { $d = $vn.AddDays($k).ToString('dd/MM/yyyy'); $specs += ($d + '|1'); $specs += ($d + '|2') }
  $tot = Probe $specs
  if (@($tot.Values | Where-Object { $_ -lt 0 }).Count -eq $tot.Count) { throw 'VPA không trả lời (có thể đang chặn)' }
  foreach ($sp in $specs) { $n = $tot[$sp]; if ($n -gt 0) { $p = $sp.Split('|'); if ($Test) { $n = [Math]::Min($n, 100) }; $plan += , @($p[0], [int]$p[1], $n)
      Log ('Danh sách chính thức phiên ' + $p[0] + ' ' + $(if ($p[1] -eq '1') { 'ô tô' } else { 'xe máy' }) + ': ' + $tot[$sp] + ' biển') } }
  $res = if ($plan.Count) { FetchPlan $plan } else { New-Object System.Collections.Generic.List[string] }
  foreach ($l in $res) {
    if ($l -eq 'ERR') { $err++; continue }
    $p = $l.Split('|'); if (-not $p[1]) { continue }
    $lich[$p[0]] = $p
    if ($p[3]) { $dm = $p[1].Split('/'); $script:regEnd[$dm[2] + $dm[1] + $dm[0]] = $p[3] }
  }
  if ($lich.Count -lt 50 -and -not $Test) { throw ('Danh sách chính thức chỉ lấy được ' + $lich.Count + ' biển (' + $err + ' lượt lỗi) — VPA có thể đang chặn, giữ nguyên dữ liệu web') }
  foreach ($k in @($rows.Keys)) { $rows[$k][3] = '' }   # bỏ lịch cũ, chỉ giữ lịch VPA đang công bố
  $add = 0
  foreach ($k in $lich.Keys) {
    $p = $lich[$k]; $cnt = -1; [int]::TryParse($p[2], [ref]$cnt) | Out-Null
    if ($rows.ContainsKey($k)) { $rows[$k][3] = $p[1]; if ($cnt -ge 0) { $rows[$k][4] = $cnt } }
    else { $moto = if ($p[4] -eq '2') { 1 } else { 0 }; $rows[$k] = @($k, '0', $moto, $p[1], $cnt); $add++ }
  }
  $script:nLich = $lich.Count
  Log ('Danh sách chính thức: ' + $lich.Count + ' biển có lịch, thêm mới ' + $add + ' biển (' + $err + ' lượt lỗi)')
  Publish 'danh sach chinh thuc'

  # 3) Danh sách công bố: toàn bộ ô tô rồi xe máy (trừ -Quick / -Test); xong phần nào đưa lên web phần đó
  if ($Full -and -not $Test) {
    foreach ($site in 1, 2) {
      $ten = if ($site -eq 1) { 'ô tô' } else { 'xe máy' }; $moto = $site - 1
      $total = (Probe @('|' + $site))['|' + $site]
      if ($total -le 0) { Log ('Danh sách công bố ' + $ten + ': VPA không trả về tổng số — bỏ qua'); continue }
      Log ('Danh sách công bố ' + $ten + ': ' + $total + ' biển — đang tải toàn bộ...')
      $res = FetchPlan @(, @('', $site, $total))
      $err = @($res | Where-Object { $_ -eq 'ERR' }).Count
      $got = New-Object 'System.Collections.Generic.Dictionary[string,int]'
      foreach ($l in $res) { if ($l -ne 'ERR') { $p = $l.Split('|'); $cnt = -1; [int]::TryParse($p[2], [ref]$cnt) | Out-Null; $got[$p[0]] = $cnt } }
      if ($got.Count -ge 0.9 * $total) {
        $del = 0
        # biển VPA đã gỡ khỏi cả 2 danh sách (không còn trong công bố, không có lịch) -> gỡ khỏi web
        foreach ($k in @($rows.Keys)) { if ($rows[$k][2] -eq $moto -and -not $got.ContainsKey($k) -and -not $rows[$k][3]) { $rows.Remove($k) | Out-Null; $del++ } }
        $add = 0
        foreach ($k in $got.Keys) { if ($rows.ContainsKey($k)) { if (-not $rows[$k][3] -and $got[$k] -ge 0) { $rows[$k][4] = $got[$k] } } else { $rows[$k] = @($k, '0', $moto, '', $got[$k]); $add++ } }
        Log ('Danh sách công bố ' + $ten + ': ' + $got.Count + '/' + $total + ' biển, thêm ' + $add + ', gỡ ' + $del + ' (' + $err + ' lượt lỗi)')
        Publish ('danh sach cong bo ' + $(if ($site -eq 1) { 'o to' } else { 'xe may' }))
      } else { Log ('Danh sách công bố ' + $ten + ': chỉ lấy được ' + $got.Count + '/' + $total + ' — giữ danh sách cũ') }
    }
  }
  Log '==== Xong ===='
}
catch {
  Log ('LỖI: ' + $_.Exception.Message)
  exit 1
}
finally { Stop-Chrome }
