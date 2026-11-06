# Đồng bộ biển VPA cho khobienphongthuy.vn — chạy trên máy Windows của chủ web (mạng Việt Nam).
# Tích hợp đầy đủ 4 API công khai toàn quốc của VPA (https://dgbs.vpa.com.vn/search-api/search/...):
#   1) POST /search-api/search/list-announcement-plan-code  (Danh sách mã kế hoạch / Phiên công bố)
#   2) POST /search-api/search/list-announcement-plan       (Danh sách biển chính thức / Kế hoạch đấu giá)
#   3) POST /search-api/search/list-published-license-plate (Danh sách biển công bố)
#   4) POST /search-api/search/get-all-wh-license-plate     (Kho biển số VPA -> kho-vpa-o-to.json, kho-vpa-xe-may.json, index.json)
#
# Chạy tay:  powershell -ExecutionPolicy Bypass -File vpa-sync.ps1               (toàn bộ: lịch đấu + kế hoạch + công bố + kho VPA)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Quick        (chỉ cập nhật lịch đấu 21 ngày tới, vài phút)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Warehouse    (chỉ đồng bộ Kho biển số VPA)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Published    (chỉ đồng bộ Danh sách biển công bố)
#            powershell -ExecutionPolicy Bypass -File vpa-sync.ps1 -Test         (chạy thử tất cả 4 API, không đưa lên web)
param([switch]$Quick, [switch]$Test, [switch]$UploadOnly, [switch]$Warehouse, [switch]$Published)
# Mặc định mỗi lần chạy lấy LẠI TOÀN BỘ cả danh sách chính thức, danh sách công bố và kho biển số VPA.
$Full = (-not $Quick) -and (-not $Warehouse) -and (-not $Published)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

# ===== CẤU HÌNH =====
$Repo     = 'hieuhhbg2k4-tech/khobienphongthuy'
$Branch   = 'main'
$LiveUrl  = 'https://khobienphongthuy.vn/vpa-data/live.json'
$IndexUrl = 'https://khobienphongthuy.vn/vpa-data/index.json'
$Days     = 21          # lấy lịch đấu giá trong 21 ngày tới
$Threads  = 2           # số yêu cầu gửi cùng lúc — VPA giới hạn tốc độ (lỗi 429 nếu hỏi dồn), 2 là mức an toàn đã thử
$Page     = 25          # VPA chỉ trả 25 biển mỗi lần
$Dir      = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$RepoRoot = [IO.Path]::GetFullPath((Join-Path $Dir '..\..'))
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
  if ($m.Success) { return [regex]::Unescape($m.Groups[1].Value) }
  if ($res -match '"exceptionDetails"') { throw ('Chrome báo lỗi: ' + $res.Substring(0, [Math]::Min(300, $res.Length))) }
  return ''
}
function Stop-Chrome { try { if ($script:ws) { $script:ws.Dispose() } } catch {}; try { if ($script:chrome -and -not $script:chrome.HasExited) { Stop-Process -Id $script:chrome.Id -Force } } catch {}
  try { Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*remote-debugging-port=9333*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } } catch {} }

# API 1: Danh sách mã kế hoạch / Phiên công bố (POST /search-api/search/list-announcement-plan-code)
$JsPlanCodes = @'
(async (siteId) => {
  try {
    const r = await fetch('/search-api/search/list-announcement-plan-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId: +siteId })
    });
    if (!r.ok) return '';
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.data || j.content || []);
    return arr.map(x => (x.announcementPlanCode || '') + '|' + (x.announcementCode || '')).join(';');
  } catch (e) { return ''; }
})
'@

# API 2: Danh sách biển chính thức / Kế hoạch đấu giá (POST /search-api/search/list-announcement-plan)
# Payload chuẩn kết hợp cả provinceCode, licensePlate, plateType: [] và province, license_plate, auctionDate
$JsFn = @'
(async (planText, conc, probeOnly) => {
  const api = '/search-api/search/list-announcement-plan';
  const body = (d, s, o, p, ann) => JSON.stringify({
    offset: o,
    limit: 25,
    provinceCode: p || '',
    province: p || '',
    vehicle: '',
    announcementNumber: ann || '',
    colorCode: -1,
    licensePlate: '',
    license_plate: '',
    plateType: [],
    auctionDate: d || '',
    siteId: +s
  });
  const post = async (d, s, o, p, ann) => {
    for (let t = 0; t < 12; t++) {
      let st = 0;
      try {
        const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(d, s, o, p, ann) });
        st = r.status;
        if (r.ok) return await r.json();
      } catch (e) {}
      await new Promise(z => setTimeout(z, st === 429 ? 30000 : 2000 * (t + 1)));
    }
    return null;
  };
  const items = planText.split(';').filter(Boolean).map(x => x.split('|'));
  if (probeOnly) {
    const out = [];
    for (const [d, s, ann] of items) {
      const j = await post(d, s, 0, '', ann || '');
      out.push(d + '|' + s + '|' + (j ? (j.totalElements || 0) : -1));
    }
    return out.join(';');
  }
  const tasks = [];
  for (const [d, s, tot, ann] of items) {
    if (+tot > 20000) {
      const tots = [];
      for (let k = 1; k <= 99; k++) {
        const c = String(k).padStart(2, '0');
        const j = await post(d, s, 0, c, ann || '');
        if (j && j.totalElements) tots.push([c, j.totalElements]);
      }
      const sum = tots.reduce((a, b) => a + b[1], 0);
      if (sum >= 0.98 * +tot) {
        for (const [c, n] of tots) for (let o = 0; o < n; o += 25) tasks.push([d, s, o, c, ann || '']);
        continue;
      }
    }
    for (let o = 0; o < +tot; o += 25) tasks.push([d, s, o, '', ann || '']);
  }
  const out = []; let i = 0;
  const w = async () => {
    while (i < tasks.length) {
      const [d, s, o, pv, ann] = tasks[i++];
      const j = await post(d, s, o, pv, ann);
      if (!j) { out.push('ERR'); continue; }
      for (const x of (j.content || [])) {
        out.push(x.bks + '|' + (x.auctionDate || '') + '|' + (x.totalRegisteringPeople == null ? '' : x.totalRegisteringPeople) + '|' + (x.timeEndRegister || '') + '|' + s + '|' + (x.announcementNumber || ''));
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, w));
  return out.join(';');
})
'@

# API 3: Danh sách biển công bố (POST /search-api/search/list-published-license-plate)
# Trả về: licensePlate, provinceName, vehicleName, currentAuctionPrice, currentAuctionDate, totalRegistered...
$JsPublished = @'
(async (siteId, conc, cap, ann) => {
  const api = '/search-api/search/list-published-license-plate';
  const body = (o, p) => JSON.stringify({
    offset: o,
    limit: 25,
    provinceCode: p || '',
    province: p || '',
    announcementNumber: ann || '',
    colorCode: -1,
    licensePlate: '',
    plateType: [],
    status: 3,
    siteId: +siteId
  });
  const post = async (o, p) => {
    for (let t = 0; t < 12; t++) {
      let st = 0;
      try {
        const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(o, p) });
        st = r.status;
        if (r.ok) return await r.json();
      } catch (e) {}
      await new Promise(z => setTimeout(z, st === 429 ? 30000 : 2000 * (t + 1)));
    }
    return null;
  };
  const j0 = await post(0, '');
  const tot = j0 ? (j0.totalElements || 0) : -1;
  if (tot <= 0) return '#' + tot;
  const tasks = [];
  if (cap > 0) {
    const n = Math.min(tot, cap);
    for (let o = 0; o < n; o += 25) tasks.push([o, '']);
  } else if (tot > 20000) {
    const tots = [];
    for (let k = 1; k <= 99; k++) {
      const c = String(k).padStart(2, '0');
      const j = await post(0, c);
      if (j && j.totalElements) tots.push([c, j.totalElements]);
    }
    const sum = tots.reduce((a, b) => a + b[1], 0);
    if (sum >= 0.95 * tot) {
      for (const [c, n] of tots) for (let o = 0; o < n; o += 25) tasks.push([o, c]);
    } else {
      for (let o = 0; o < tot; o += 25) tasks.push([o, '']);
    }
  } else {
    for (let o = 0; o < tot; o += 25) tasks.push([o, '']);
  }
  const out = ['#' + tot]; let i = 0;
  const w = async () => {
    while (i < tasks.length) {
      const [o, pv] = tasks[i++];
      const j = await post(o, pv);
      if (!j) { out.push('ERR'); continue; }
      for (const x of (j.content || [])) {
        if (!x.licensePlate) continue;
        let dStr = '';
        if (x.currentAuctionDate) {
          const dt = new Date(Number(x.currentAuctionDate) + 7 * 3600e3);
          const z = n => String(n).padStart(2, '0');
          dStr = z(dt.getUTCDate()) + '/' + z(dt.getUTCMonth() + 1) + '/' + dt.getUTCFullYear();
        }
        out.push(x.licensePlate + '|' + dStr + '|' + (x.totalRegistered == null ? '' : x.totalRegistered) + '|' + (x.colorCode == null ? '' : x.colorCode));
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, w));
  return out.join(';');
})
'@

# API 4: Kho biển số VPA (POST /search-api/search/get-all-wh-license-plate)
# Trả về: licensePlate, whLicensePlateId, provinceCode, announcementName, colorCode...
$JsWarehouse = @'
(async (siteId, conc, cap, ann) => {
  const api = '/search-api/search/get-all-wh-license-plate';
  const body = (o, p) => JSON.stringify({
    offset: o,
    limit: 25,
    provinceCode: p || '',
    announcementNumber: ann || '',
    colorCode: -1,
    licensePlate: '',
    plateType: [],
    siteId: +siteId
  });
  const post = async (o, p) => {
    for (let t = 0; t < 12; t++) {
      let st = 0;
      try {
        const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(o, p) });
        st = r.status;
        if (r.ok) return await r.json();
      } catch (e) {}
      await new Promise(z => setTimeout(z, st === 429 ? 30000 : 2000 * (t + 1)));
    }
    return null;
  };
  const j0 = await post(0, '');
  const tot = j0 ? (j0.totalElements || 0) : -1;
  if (tot <= 0) return '#' + tot;
  const tasks = [];
  if (cap > 0) {
    const n = Math.min(tot, cap);
    for (let o = 0; o < n; o += 25) tasks.push([o, '']);
  } else if (tot > 5000) {
    const tots = [];
    for (let k = 1; k <= 99; k++) {
      const c = String(k).padStart(2, '0');
      const j = await post(0, c);
      if (j && j.totalElements) tots.push([c, j.totalElements]);
    }
    const sum = tots.reduce((a, b) => a + b[1], 0);
    if (sum >= 0.95 * tot) {
      for (const [c, n] of tots) for (let o = 0; o < n; o += 25) tasks.push([o, c]);
    } else {
      for (let o = 0; o < tot; o += 25) tasks.push([o, '']);
    }
  } else {
    for (let o = 0; o < tot; o += 25) tasks.push([o, '']);
  }
  const out = ['#' + tot]; let i = 0;
  const w = async () => {
    while (i < tasks.length) {
      const [o, pv] = tasks[i++];
      const j = await post(o, pv);
      if (!j) { out.push('ERR'); continue; }
      for (const x of (j.content || [])) {
        if (!x.licensePlate) continue;
        out.push(x.licensePlate + '|' + (x.colorCode == null ? '' : x.colorCode) + '|' + (x.announcementName || '') + '|' + (x.idKy || ''));
      }
    }
  };
  await Promise.all(Array.from({ length: conc }, w));
  return out.join(';');
})
'@

function FetchPlanCodes($siteId) {
  $raw = Eval ($JsPlanCodes + "(" + $siteId + ")")
  $list = @()
  foreach ($item in $raw.Split(';')) {
    if ($item) {
      $p = $item.Split('|')
      $list += @{ name = $p[0]; code = if ($p.Length -gt 1) { $p[1] } else { '' } }
    }
  }
  , $list
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
function FetchPublished($siteId, $cap, $ann) {
  $raw = Eval ($JsPublished + "(" + $siteId + "," + $Threads + "," + $cap + ",'" + $ann + "')")
  $out = New-Object System.Collections.Generic.List[string]
  $tot = -1
  foreach ($l in $raw.Split(';')) {
    if (-not $l) { continue }
    if ($l.StartsWith('#')) { [int]::TryParse($l.Substring(1), [ref]$tot) | Out-Null }
    else { $out.Add($l) }
  }
  @{ total = $tot; lines = $out }
}
function FetchWarehouse($siteId, $cap, $ann) {
  $raw = Eval ($JsWarehouse + "(" + $siteId + "," + $Threads + "," + $cap + ",'" + $ann + "')")
  $out = New-Object System.Collections.Generic.List[string]
  $tot = -1
  foreach ($l in $raw.Split(';')) {
    if (-not $l) { continue }
    if ($l.StartsWith('#')) { [int]::TryParse($l.Substring(1), [ref]$tot) | Out-Null }
    else { $out.Add($l) }
  }
  @{ total = $tot; lines = $out }
}

# Đóng gói danh sách biển vào định dạng chuẩn vpa-data/kho-vpa-*.json: {"g": {"30K": "5555566666..."}}
function BuildGroupJson($plateSet, $siteId) {
  $groups = @{}
  foreach ($raw in $plateSet) {
    $s = ([string]$raw).ToUpper() -replace '[^0-9A-Z]', ''
    $m = [regex]::Match($s, '^(\d{2}[A-Z]{1,2}\d?)(\d{5})$')
    if (-not $m.Success) { continue }
    $head = $m.Groups[1].Value; $tail = $m.Groups[2].Value
    if ($siteId -eq 1 -and $head.Length -ge 3 -and ($head[2] -eq 'H' -or $head[2] -eq 'E')) { continue }
    if (-not $groups.ContainsKey($head)) { $groups[$head] = New-Object System.Collections.Generic.List[string] }
    $groups[$head].Add($tail)
  }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('{"g":{')
  $first = $true
  $totalCount = 0
  foreach ($h in ($groups.Keys | Sort-Object)) {
    $uniq = @($groups[$h] | Sort-Object -Unique)
    $totalCount += $uniq.Count
    if (-not $first) { [void]$sb.Append(',') }
    $first = $false
    [void]$sb.Append('"' + $h + '":"' + ($uniq -join '') + '"')
  }
  [void]$sb.Append('}}')
  @{ json = $sb.ToString(); count = $totalCount }
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
  if (-not $Test) {
    $repoLive = Join-Path $RepoRoot 'vpa-data\live.json'
    if (Test-Path (Split-Path $repoLive -Parent)) {
      try { [IO.File]::WriteAllText($repoLive, $json, (New-Object Text.UTF8Encoding $false)) } catch {}
    }
  }
  if ($env:SKIP_UPLOAD) { Log ('[' + $buoc + '] (kiểm thử) ' + $rows.Count + ' biển'); return }
  if ($Test) { Log ('[' + $buoc + '] Đã ghi ' + $outFile + ' (' + $rows.Count + ' biển) — chạy thử, không đưa lên web'); return }
  UploadFiles @{ 'vpa-data/live.json' = $json } $buoc $stamp
  Log ('[' + $buoc + '] ĐÃ ĐƯA LÊN WEB: ' + $rows.Count + ' biển, ' + $script:nLich + ' biển có lịch')
}

function UploadFiles($fileMap, $buoc, $stamp) {
  if (-not (Test-Path $TokenFile)) { throw ('Chưa có file ' + $TokenFile + ' chứa mã GitHub') }
  $tok = (Get-Content $TokenFile -Raw).Trim()
  $H = @{ Authorization = 'Bearer ' + $tok; Accept = 'application/vnd.github+json'; 'User-Agent' = 'vpa-sync-khobienphongthuy' }
  $gh = 'https://api.github.com/repos/' + $Repo
  $U8 = [Text.Encoding]::UTF8
  $step = 'đọc nhánh'
  try {
    $ref = Invoke-RestMethod -Uri ($gh + '/git/ref/heads/' + $Branch) -Headers $H -TimeoutSec 120
    $base = Invoke-RestMethod -Uri ($gh + '/git/commits/' + $ref.object.sha) -Headers $H -TimeoutSec 120
    $treeEntries = @()
    foreach ($path in $fileMap.Keys) {
      $contentStr = $fileMap[$path]
      $blobBody = $U8.GetBytes('{"content":"' + [Convert]::ToBase64String($U8.GetBytes($contentStr)) + '","encoding":"base64"}')
      $step = 'tải file ' + $path + ' lên'
      $blob = Invoke-RestMethod -Uri ($gh + '/git/blobs') -Method Post -Headers $H -Body $blobBody -ContentType 'application/json' -TimeoutSec 600
      $treeEntries += ('{"path":"' + $path + '","mode":"100644","type":"blob","sha":"' + $blob.sha + '"}')
    }
    $step = 'tạo cây thư mục'
    $treeJson = '{"base_tree":"' + $base.tree.sha + '","tree":[' + ($treeEntries -join ',') + ']}'
    $tree = Invoke-RestMethod -Uri ($gh + '/git/trees') -Method Post -Headers $H -ContentType 'application/json' -TimeoutSec 300 -Body ($U8.GetBytes($treeJson))
    $step = 'tạo commit'
    $commit = Invoke-RestMethod -Uri ($gh + '/git/commits') -Method Post -Headers $H -ContentType 'application/json' -TimeoutSec 300 -Body ($U8.GetBytes('{"message":"Cap nhat bien VPA tu may tinh: ' + $buoc + ' (' + $stamp + ')","tree":"' + $tree.sha + '","parents":["' + $ref.object.sha + '"]}'))
    $step = 'cập nhật nhánh'
    Invoke-RestMethod -Uri ($gh + '/git/refs/heads/' + $Branch) -Method Patch -Headers $H -ContentType 'application/json' -TimeoutSec 120 -Body ($U8.GetBytes('{"sha":"' + $commit.sha + '"}')) | Out-Null
  } catch { $msg = $_.Exception.Message; if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $msg += ' | ' + $_.ErrorDetails.Message }; throw ('GitHub lỗi ở bước ' + $step + ': ' + $msg) }
  try { Invoke-RestMethod -Uri ($gh + '/pages/builds') -Method Post -Headers $H -TimeoutSec 60 | Out-Null } catch {}
}

function Upload($json, $buoc, $stamp) {
  UploadFiles @{ 'vpa-data/live.json' = $json } $buoc $stamp
}


try {
  Log ('==== Bắt đầu' + $(if ($Test) { ' (chạy thử 4 API VPA)' } elseif ($Quick) { ' (chỉ lịch đấu)' } elseif ($Warehouse) { ' (chỉ Kho biển số VPA)' } elseif ($Published) { ' (chỉ Danh sách công bố)' } else { ' (toàn bộ 4 API VPA: kế hoạch + lịch đấu + công bố + kho VPA)' }) + ' ====')
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
    $rows[$m.Groups[1].Value] = @($m.Groups[1].Value, $m.Groups[2].Value, [int]$m.Groups[3].Value, $m.Groups[4].Value, [int]$m.Groups[5].Value)
  }
  $provs = '[]'; $pm = [regex]::Match($old, '"provs"\s*:\s*(\[[^\]]*\])'); if ($pm.Success) { $provs = $pm.Groups[1].Value }
  if ($old -notmatch '"src"\s*:\s*"pc"' -and -not $Warehouse -and -not $Published) { $Full = $true }
  Log ('Dữ liệu cũ trên web: ' + $rows.Count + ' biển')
  Stop-Chrome   # tắt Chrome ngầm còn sót từ lần chạy trước (nếu có)
  Start-Chrome
  Log 'Đã mở Chrome chạy ngầm, đang hỏi VPA...'

  # Bước 1.5: Hỏi API 1 (list-announcement-plan-code) để lấy danh sách Phiên công bố hiện tại của VPA
  $codesOto = FetchPlanCodes 1
  $codesXm  = FetchPlanCodes 2
  $latestOto = if ($codesOto.Count -gt 0) { $codesOto[0].name + ' (' + $codesOto[0].code + ')' } else { 'không rõ' }
  $latestXm  = if ($codesXm.Count -gt 0) { $codesXm[0].name + ' (' + $codesXm[0].code + ')' } else { 'không rõ' }
  Log ('API 1 [list-announcement-plan-code]: Ô tô ' + $codesOto.Count + ' phiên (mới nhất: ' + $latestOto + '), Xe máy ' + $codesXm.Count + ' phiên (mới nhất: ' + $latestXm + ')')

  if (-not $Warehouse -and -not $Published) {
    # 2) API 2 (list-announcement-plan theo ngày đấu): Danh sách biển chính thức có lịch đấu + hạn đăng ký + số người ĐK
    $lich = @{}; $err = 0
    $plan = @(); $specs = @()
    $last = if ($Test) { 3 } else { $Days }
    for ($k = -1; $k -le $last; $k++) { $d = $vn.AddDays($k).ToString('dd/MM/yyyy'); $specs += ($d + '|1'); $specs += ($d + '|2') }
    $tot = Probe $specs
    if (@($tot.Values | Where-Object { $_ -lt 0 }).Count -eq $tot.Count) { throw 'VPA không trả lời (có thể đang chặn)' }
    foreach ($sp in $specs) { $n = $tot[$sp]; if ($n -gt 0) { $p = $sp.Split('|'); if ($Test) { $n = [Math]::Min($n, 100) }; $plan += , @($p[0], [int]$p[1], $n)
        Log ('API 2 [list-announcement-plan] lịch ngày ' + $p[0] + ' ' + $(if ($p[1] -eq '1') { 'ô tô' } else { 'xe máy' }) + ': ' + $tot[$sp] + ' biển') } }
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
    Log ('Danh sách chính thức (có lịch đấu): ' + $lich.Count + ' biển, thêm mới ' + $add + ' biển (' + $err + ' lượt lỗi)')
    Publish 'danh sach chinh thuc'
  }

  # 3) API 2 (list-announcement-plan toàn bộ kế hoạch): toàn bộ ô tô rồi xe máy
  if ($Full -and -not $Test) {
    foreach ($site in 1, 2) {
      $ten = if ($site -eq 1) { 'ô tô' } else { 'xe máy' }; $moto = $site - 1
      $total = (Probe @('|' + $site))['|' + $site]
      if ($total -le 0) { Log ('API 2 [list-announcement-plan] kế hoạch ' + $ten + ': VPA không trả về tổng số — bỏ qua'); continue }
      Log ('API 2 [list-announcement-plan] kế hoạch ' + $ten + ': ' + $total + ' biển — đang tải toàn bộ...')
      $res = FetchPlan @(, @('', $site, $total))
      $err = @($res | Where-Object { $_ -eq 'ERR' }).Count
      $got = New-Object 'System.Collections.Generic.Dictionary[string,int]'
      $p11Set = New-Object 'System.Collections.Generic.HashSet[string]'
      foreach ($l in $res) {
        if ($l -ne 'ERR') {
          $p = $l.Split('|'); $cnt = -1; [int]::TryParse($p[2], [ref]$cnt) | Out-Null
          $got[$p[0]] = $cnt
          if ($p.Length -le 5 -or -not $p[5] -or $p[5] -match '11') { [void]$p11Set.Add($p[0]) }
        }
      }
      if ($got.Count -ge 0.9 * $total) {
        $del = 0
        foreach ($k in @($rows.Keys)) { if ($rows[$k][2] -eq $moto -and -not $got.ContainsKey($k) -and -not $rows[$k][3]) { $rows.Remove($k) | Out-Null; $del++ } }
        $add = 0
        foreach ($k in $got.Keys) { if ($rows.ContainsKey($k)) { if (-not $rows[$k][3] -and $got[$k] -ge 0) { $rows[$k][4] = $got[$k] } } else { $rows[$k] = @($k, '0', $moto, '', $got[$k]); $add++ } }
        Log ('Kế hoạch đấu giá ' + $ten + ': ' + $got.Count + '/' + $total + ' biển, thêm ' + $add + ', gỡ ' + $del + ' (' + $err + ' lượt lỗi)')
        Publish ('ke hoach dau gia ' + $(if ($site -eq 1) { 'o to' } else { 'xe may' }))
        # Đồng thời lọc bỏ biển đã đấu khỏi file phiên tĩnh (phien-11-2026-o-to-trang.json / phien-11-2026-xe-may.json)
        $p11Slug = if ($site -eq 1) { 'phien-11-2026-o-to-trang' } else { 'phien-11-2026-xe-may' }
        $builtP11 = BuildGroupJson $p11Set $site
        if ($builtP11.count -gt 10000) {
          $stampP11 = (Get-Date).ToUniversalTime().AddHours(7).ToString('HH:mm dd/MM/yyyy')
          $p11Files = @{ ('vpa-data/' + $p11Slug + '.json') = $builtP11.json }
          try {
            $idxRaw = $wc.DownloadString($IndexUrl + '?t=' + [DateTime]::Now.Ticks)
            $idxRaw = [regex]::Replace($idxRaw, '"updated"\s*:\s*"[^"]*"', '"updated":"' + $stampP11 + '"')
            $idxRaw = [regex]::Replace($idxRaw, '(\{"id":"' + $p11Slug + '"[^}]*"count":)\d+', '${1}' + $builtP11.count)
            $p11Files['vpa-data/index.json'] = $idxRaw
          } catch {}
          if (-not $env:SKIP_UPLOAD) {
            UploadFiles $p11Files ('cap nhat ' + $p11Slug) $stampP11
            Log ('[' + $p11Slug + '] ĐÃ XOÁ BIỂN ĐÃ ĐẤU & CẬP NHẬT LÊN WEB: còn ' + $builtP11.count + ' biển')
          }
        }
      } else { Log ('Kế hoạch đấu giá ' + $ten + ': chỉ lấy được ' + $got.Count + '/' + $total + ' — giữ danh sách cũ') }
    }
  }

  # 4) API 3 (list-published-license-plate): Danh sách biển công bố của phiên mới nhất (bổ sung biển công bố mới vào live.json)
  if ($Full -or $Published -or $Test) {
    foreach ($site in 1, 2) {
      $ten = if ($site -eq 1) { 'ô tô' } else { 'xe máy' }; $moto = $site - 1
      $annName = if ($site -eq 1 -and $codesOto.Count -gt 0) { $codesOto[0].name } elseif ($site -eq 2 -and $codesXm.Count -gt 0) { $codesXm[0].name } else { '' }
      $cap = if ($Test) { 50 } elseif (-not $Published) { 0 } else { 0 }
      $pubRes = FetchPublished $site $cap $annName
      if ($pubRes.total -le 0) {
        Log ('API 3 [list-published-license-plate] ' + $ten + ' (' + $annName + '): 0 biển')
        continue
      }
      $addPub = 0; $updPub = 0
      foreach ($l in $pubRes.lines) {
        if ($l -eq 'ERR') { continue }
        $p = $l.Split('|')
        $bks = $p[0]; $dStr = $p[1]; $cnt = -1; [int]::TryParse($p[2], [ref]$cnt) | Out-Null; $col = $p[3]
        if ($site -eq 1 -and $col -eq '3') { continue }   # bỏ biển vàng ô tô
        if (-not $rows.ContainsKey($bks)) {
          if ($Published -or $Test) {
            $rows[$bks] = @($bks, '0', $moto, $dStr, $cnt)
            $addPub++
          }
        } else {
          if (-not $rows[$bks][3] -and $dStr) { $rows[$bks][3] = $dStr; $updPub++ }
          if ($rows[$bks][4] -lt 0 -and $cnt -ge 0) { $rows[$bks][4] = $cnt }
        }
      }
      Log ('API 3 [list-published-license-plate] ' + $ten + ' (' + $annName + '): tổng ' + $pubRes.total + ', đã quét ' + $pubRes.lines.Count + ', thêm mới ' + $addPub + ', cập nhật lịch ' + $updPub)
      if ($addPub -gt 0 -or $updPub -gt 0 -or $Published) {
        Publish ('danh sach cong bo ' + $(if ($site -eq 1) { 'o to' } else { 'xe may' }))
      }
    }
  }

  # 5) API 4 (get-all-wh-license-plate): Kho biển số VPA -> cập nhật vpa-data/kho-vpa-o-to.json, vpa-data/kho-vpa-xe-may.json và vpa-data/index.json
  if ($Full -or $Warehouse -or $Test) {
    $capWh = if ($Test) { 100 } else { 0 }
    $whFiles = @{}
    $whCounts = @{}
    foreach ($site in 1, 2) {
      $ten = if ($site -eq 1) { 'ô tô' } else { 'xe máy' }
      $slug = if ($site -eq 1) { 'kho-vpa-o-to' } else { 'kho-vpa-xe-may' }
      Log ('API 4 [get-all-wh-license-plate] đang tải Kho biển số VPA ' + $ten + '...')
      $whRes = FetchWarehouse $site $capWh ''
      if ($whRes.total -le 0) {
        Log ('Kho biển số VPA ' + $ten + ': VPA không trả về dữ liệu — bỏ qua')
        continue
      }
      $plateSet = New-Object 'System.Collections.Generic.HashSet[string]'
      $errWh = 0
      foreach ($l in $whRes.lines) {
        if ($l -eq 'ERR') { $errWh++; continue }
        $p = $l.Split('|')
        $bks = $p[0]; $col = $p[1]
        if ($site -eq 1 -and $col -eq '3') { continue }   # chỉ giữ biển trắng cho kho ô tô
        [void]$plateSet.Add($bks)
      }
      if ($Test -or $plateSet.Count -ge 0.85 * $whRes.total) {
        $built = BuildGroupJson $plateSet $site
        $outWhFile = Join-Path $Dir $(if ($Test) { $slug + '-thu.json' } else { $slug + '.json' })
        [IO.File]::WriteAllText($outWhFile, $built.json, (New-Object Text.UTF8Encoding $false))
        if (-not $Test) {
          $repoWh = Join-Path $RepoRoot ('vpa-data\' + $slug + '.json')
          if (Test-Path (Split-Path $repoWh -Parent)) {
            try { [IO.File]::WriteAllText($repoWh, $built.json, (New-Object Text.UTF8Encoding $false)) } catch {}
          }
        }
        $whFiles['vpa-data/' + $slug + '.json'] = $built.json
        $whCounts[$slug] = $built.count
        Log ('API 4 [get-all-wh-license-plate] Kho VPA ' + $ten + ': ' + $built.count + ' biển trắng / ' + $whRes.total + ' tổng (' + $errWh + ' lượt lỗi)')
      } else {
        Log ('Kho VPA ' + $ten + ': chỉ lấy được ' + $plateSet.Count + '/' + $whRes.total + ' — giữ file cũ')
      }
    }

    if ($whFiles.Count -gt 0) {
      $stamp = (Get-Date).ToUniversalTime().AddHours(7).ToString('HH:mm dd/MM/yyyy')
      try {
        $idxRaw = $wc.DownloadString($IndexUrl + '?t=' + [DateTime]::Now.Ticks)
        $idxRaw = [regex]::Replace($idxRaw, '"updated"\s*:\s*"[^"]*"', '"updated":"' + $stamp + '"')
        foreach ($slug in $whCounts.Keys) {
          $c = $whCounts[$slug]
          $idxRaw = [regex]::Replace($idxRaw, '(\{"id":"' + $slug + '"[^}]*"count":)\d+', '${1}' + $c)
        }
        $whFiles['vpa-data/index.json'] = $idxRaw
        if (-not $Test) {
          $repoIdx = Join-Path $RepoRoot 'vpa-data\index.json'
          if (Test-Path (Split-Path $repoIdx -Parent)) {
            try { [IO.File]::WriteAllText($repoIdx, $idxRaw, (New-Object Text.UTF8Encoding $false)) } catch {}
          }
        }
      } catch {
        Log ('Không cập nhật được index.json: ' + $_.Exception.Message)
      }
      if ($Test) {
        Log ('[kho vpa] Đã ghi file thử nghiệm kho-vpa-*-thu.json — chạy thử, không đưa lên web')
      } elseif (-not $env:SKIP_UPLOAD) {
        UploadFiles $whFiles 'kho bien so VPA' $stamp
        Log ('[kho vpa] ĐÃ ĐƯA LÊN WEB: ' + ($whCounts.Keys | ForEach-Object { $_ + '=' + $whCounts[$_] }) -join ', ')
      }
    }
  }

  Log '==== Xong ===='
}
catch {
  Log ('LỖI: ' + $_.Exception.Message)
  exit 1
}
finally { Stop-Chrome }
