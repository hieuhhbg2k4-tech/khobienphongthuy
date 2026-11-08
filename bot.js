const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '8917031192:AAEp-UxhwMKsFeWojBrrjC8x0DOZi1sOx4w';
const PORT = process.env.PORT || 10000;

// Thư viện vẽ ảnh Canvas / Sharp
let canvasLib = null;
try { canvasLib = require('@napi-rs/canvas'); } catch (e) { }

let sharpLib = null;
try { sharpLib = require('sharp'); } catch (e) { }

// Dữ liệu ảnh mẫu Base64 & Font chữ nhúng
let templates = null;
try { templates = require('./templates-data.js'); } catch (e) { }

let canvasFontRegistered = false;
const fontFilePath = path.join(__dirname, 'ariblk.ttf');

function ensureFontFile() {
  if (fs.existsSync(fontFilePath)) return fontFilePath;
  if (templates && templates.b64Font) {
    try {
      fs.writeFileSync(fontFilePath, Buffer.from(templates.b64Font, 'base64'));
      return fontFilePath;
    } catch (e) { }
  }
  return null;
}

if (canvasLib) {
  try {
    const fPath = ensureFontFile();
    if (fPath && canvasLib.GlobalFonts) {
      canvasLib.GlobalFonts.registerFromPath(fPath, 'PlateFont');
      canvasFontRegistered = true;
      console.log("Đã đăng ký PlateFont (Arial Black) vào Canvas!");
    }
  } catch (e) {
    console.log("Canvas font status:", e.message);
  }
}

/* ===== BỘ MÁY PHONG THỦY ===== */
const FMT_ORDER = ["Ngũ quý","Tứ quý","Tứ quý đầu","Tứ quý đuôi","Sảnh tiến","Tam hoa","Lộc phát","Thần tài","Ông địa","Đuôi 99","Đuôi 89","Năm sinh","ABAB","ABBA","AABB","Đối xứng","Kép đuôi","Số đẹp"];
const B = {}; FMT_ORDER.forEach((f, i) => B[f] = 1 << i);

const NEWPROV = (() => {
  const g = {
    "Hà Nội":"29 30 31 32 33 40", "Hồ Chí Minh":"41 50 51 52 53 54 55 56 57 58 59 61 72", "Hải Phòng":"15 16 34",
    "Hưng Yên":"89 17", "Ninh Bình":"35 18 90", "Phú Thọ":"19 28 88", "Thái Nguyên":"20 97", "Tuyên Quang":"22 23",
    "Lào Cai":"24 21", "Bắc Ninh":"99 98", "Quảng Ninh":"14", "Cao Bằng":"11", "Lạng Sơn":"12", "Lai Châu":"25",
    "Sơn La":"26", "Điện Biên":"27", "Thanh Hóa":"36", "Nghệ An":"37", "Hà Tĩnh":"38", "Quảng Trị":"74 73", "Huế":"75",
    "Đà Nẵng":"43 92", "Quảng Ngãi":"76 82", "Gia Lai":"81 77", "Đắk Lắk":"47 78", "Khánh Hòa":"79 85",
    "Lâm Đồng":"49 48 86", "Đồng Nai":"60 93", "Tây Ninh":"70 62", "Đồng Tháp":"66 63", "Vĩnh Long":"64 71 84",
    "Cần Thơ":"65 83 95", "An Giang":"67 68", "Cà Mau":"69 94"
  }, m = {};
  for (const p in g) g[p].split(" ").forEach(c => m[c] = p);
  return m;
})();
const provOf = code => NEWPROV[code] || "Khác";

// Bỏ 100% biển vàng (29E, 30E, 29H, 30H, v.v. cả nước)
function isYellowPlate(prefix) {
  if (!prefix) return false;
  return /^\d{2}[EH]/i.test(prefix);
}

const HN_CODES = new Set(["29", "30", "31", "32", "33", "40"]);
const TAM_HOA_DAU_MIN = { "1": 79, "4": 79, "7": 89, "2": 99, "3": 99, "5": 99, "6": 109, "8": 119, "9": 119, "0": 79 };
const LAN_CAN = new Set(["Bắc Ninh", "Hưng Yên", "Phú Thọ", "Thái Nguyên", "Ninh Bình", "Hải Phòng"]);

const ELEM = ["Thổ","Thủy","Hỏa","Mộc","Kim","Thổ","Thủy","Hỏa","Mộc","Kim"];
const SINH = { "Kim":"Thổ", "Thủy":"Kim", "Mộc":"Thủy", "Hỏa":"Mộc", "Thổ":"Hỏa" };
const menhOk = (x, m) => { const e = ELEM[x % 10]; return e === m || e === SINH[m]; };

function classify(x) {
  const a = Math.floor(x / 10000), b = Math.floor(x / 1000) % 10, c = Math.floor(x / 100) % 10, d = Math.floor(x / 10) % 10, e = x % 10;
  let m = 0;
  if (a===b && b===c && c===d && d===e) m |= B["Ngũ quý"];
  else if ((b===c && c===d && d===e) || (a===b && b===c && c===d)) m |= B["Tứ quý"];

  if (!m && ((b===a+1 && c===b+1 && d===c+1 && e===d+1) || (c===b+1 && d===c+1 && e===d+1))) m |= B["Sảnh tiến"];
  if (!(m & (B["Ngũ quý"] | B["Tứ quý"])) && ((c===d && d===e) || (a===b && b===c))) m |= B["Tam hoa"];

  const l2 = d * 10 + e;
  if (l2 === 68 || l2 === 86) m |= B["Lộc phát"];
  if (l2 === 39 || l2 === 79) m |= B["Thần tài"];
  if (l2 === 38 || l2 === 78) m |= B["Ông địa"];

  const y = x % 10000;
  if ((b===1 && c===9 && y>=1950) || (b===2 && c===0 && y<=2030)) m |= B["Năm sinh"];
  if (b===d && c===e && b!==c) m |= B["ABAB"];
  if (b===e && c===d && b!==c) m |= B["ABBA"];
  if (b===c && d===e && b!==d) m |= B["AABB"];
  if (a===e && b===d && !(m & B["Ngũ quý"])) m |= B["Đối xứng"];
  if (!m && d===e) m |= B["Kép đuôi"];
  if (!m) m |= B["Số đẹp"];

  if (m & B["Tứ quý"]) m |= (a===b && b===c && c===d) ? B["Tứ quý đầu"] : B["Tứ quý đuôi"];
  if (l2 === 99) m |= B["Đuôi 99"];
  if (l2 === 89) m |= B["Đuôi 89"];
  return m;
}

const nutOf = x => (Math.floor(x/10000) + Math.floor(x/1000)%10 + Math.floor(x/100)%10 + Math.floor(x/10)%10 + x%10) % 10 || 10;
const pad5 = n => String(n).padStart(5, "0");

function removeAccents(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function getTodayInt() {
  const d = new Date(Date.now() + 7 * 3600e3);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/* ===== KHO BIỂN & BẢNG GIÁ ===== */
let giaData = null;
const storage = {
  prefixes: [],
  plates: []
};

function fetchWithRedirect(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchWithRedirect(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function loadData() {
  console.log("Đang nạp dữ liệu kho biển phong thủy...");
  try {
    let liveData = null;

    const giaPath = path.join(__dirname, 'assets', 'gia.json');
    const livePath = path.join(__dirname, 'vpa-data', 'live.json');

    if (fs.existsSync(giaPath)) {
      console.log("Đọc bảng giá từ file local assets/gia.json");
      giaData = JSON.parse(fs.readFileSync(giaPath, 'utf8'));
    } else {
      giaData = await fetchWithRedirect('https://khobienphongthuy.vn/assets/gia.json');
    }

    if (fs.existsSync(livePath)) {
      console.log("Đọc kho biển từ file local vpa-data/live.json");
      liveData = JSON.parse(fs.readFileSync(livePath, 'utf8'));
    } else {
      liveData = await fetchWithRedirect('https://khobienphongthuy.vn/vpa-data/live.json');
    }

    // Nạp biển (bỏ 100% biển vàng 29E, 30E...)
    storage.prefixes = [];
    storage.plates = [];
    const preMap = new Map();

    if (liveData && Array.isArray(liveData.rows)) {
      console.log(`Đang xử lý ${liveData.rows.length} biển từ live.json...`);
      for (let i = 0; i < liveData.rows.length; i++) {
        const row = liveData.rows[i];
        const raw = String(row[0] || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
        const reg = raw.match(/^(\d{2}[A-Z][A-Z0-9]?)(\d{5})$/);
        if (!reg) continue;

        const prefix = reg[1];
        if (isYellowPlate(prefix)) continue; // Bỏ 100% biển vàng

        const num = parseInt(reg[2], 10);
        const moto = row[2] ? 1 : 0;

        // Ngày đấu giá
        const dm = String(row[3] || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        const dateInt = dm ? +(dm[3] + dm[2] + dm[1]) : 0;
        const dateShort = dm ? `${dm[1]}/${dm[2]}` : "";
        const cnt = typeof row[4] === "number" ? row[4] : -1;

        let pIdx = preMap.get(prefix);
        if (pIdx === undefined) {
          pIdx = storage.prefixes.length;
          preMap.set(prefix, pIdx);
          storage.prefixes.push(prefix);
        }

        storage.plates.push({
          pIdx,
          num,
          tag: classify(num),
          nut: nutOf(num),
          moto,
          date: dateInt,
          dateShort,
          cnt
        });
      }
    }
    console.log(`ĐÃ NẠP THÀNH CÔNG ${storage.plates.length} BIỂN SỐ VÀO HỆ THỐNG (Đã loại toàn bộ biển vàng)!`);
  } catch (err) {
    console.error("Lỗi nạp kho:", err);
  }
}

// Khởi chạy Web Server cho Render 24/7
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<h1>KhoBienPhongThuy Bot is running 24/7!</h1><p>Đã nạp thành công <b>${storage.plates.length}</b> biển số sạch (không có biển vàng).</p>`);
});
server.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

/* ===== TÍNH GIÁ CHUẨN THEO THUẬT TOÁN WEB ===== */
function calculatePrice(prefix, num, moto, tag) {
  if (!giaData) return { priceNum: 79, text: "79 tr" };
  const n = pad5(num);
  const key = prefix + n;
  const tbl = moto ? (giaData.m || giaData) : giaData;
  const floor = (tbl && tbl.min) ? tbl.min : (moto ? 15 : 79);

  // 1. Kiểm tra bảng p (biển riêng)
  if (giaData.p && giaData.p[key] != null) {
    return formatGiaValue(giaData.p[key]);
  }

  const provCode = prefix.slice(0, 2);
  const isHN = HN_CODES.has(provCode);
  const provName = provOf(provCode);
  const isLanCan = LAN_CAN.has(provName);

  // 2. Giá riêng chủ web đặt theo 5 số cuối (ô tô): [Hà Nội, tỉnh lân cận, tỉnh xa]
  if (!moto && giaData.rieng && giaData.rieng[n]) {
    const r = giaData.rieng[n];
    const val = r[isHN ? 0 : isLanCan ? 1 : 2];
    return formatGiaValue(val);
  }

  // 3. Dòng tiến đuôi 68 biển Hà Nội
  if (!moto && isHN && /68$/.test(n) && !/[47]/.test(n) && !/(\d)\1\1/.test(n)
      && n[0] <= n[1] && n[1] <= n[2] && n[2] <= n[3]) {
    return formatGiaValue(n[0] === "0" ? 130 : 150);
  }

  // 4. Dòng tiến đuôi 99 biển Hà Nội
  if (!moto && isHN && /^\d\d\d99$/.test(n) && !/[47]/.test(n) && (n === "00099" || !/(\d)\1\1/.test(n)) && !/8899$/.test(n)
      && n[0] <= n[1] && n[1] <= n[2] && n[2] <= "9") {
    return formatGiaValue(n[0] === "0" ? 120 : 140);
  }

  // 5. Tứ quý đuôi X.AAAA biển Hà Nội
  if (!moto && giaData.tqd_hn && isHN && /^(\d)(\d)\2\2\2$/.test(n) && n[0] !== n[1] && giaData.tqd_hn[n[1]] != null) {
    return formatGiaValue(giaData.tqd_hn[n[1]]);
  }

  // 6. Tam hoa kép AA.BBB: [Hà Nội, lân cận, tỉnh xa]
  if (!moto && giaData.kep && giaData.kep[n]) {
    const kep = giaData.kep[n];
    const z = isHN ? 0 : isLanCan ? 1 : 2;
    const val = kep[z];
    return formatGiaValue(val >= 1000 ? -1 : val);
  }

  // 7. Tam hoa đầu AAA.XY
  if (!moto && /^(\d)\1\1/.test(n) && n[3] !== n[0]) {
    const z = isHN ? 0 : isLanCan ? 1 : 2;
    const th = giaData.th && giaData.th[n];
    let v = Math.max(th ? th[z] : 0, TAM_HOA_DAU_MIN[n[0]] || floor);
    return formatGiaValue(v >= 1000 ? -1 : v);
  }

  // 8. Lịch sử trúng VPA: tbl.t
  const hv = tbl && tbl.t && tbl.t[n] ? tbl.t[n][isHN ? 0 : 1] : null;

  // 9. Kho biển: giaData.k
  const kb = giaData.k && giaData.k[key] != null ? giaData.k[key] : null;

  if (kb === -1 || hv === -1) return { priceNum: -1, text: "Liên hệ" };

  let v;
  if (kb != null) {
    v = Math.max(hv || floor, Math.round(kb * 1.10));
  } else {
    const isVip = (tag & (B["Ngũ quý"] | B["Tứ quý"] | B["Sảnh tiến"]));
    if (!moto && isVip && hv == null) {
      return { priceNum: -1, text: "Liên hệ" };
    }
    v = hv != null ? Math.max(floor, hv) : floor;
    if (!moto && /^(\d)\1(\d)\2\2$|^(\d)\3\3(\d)\4$/.test(n) && n[0] !== n[4] && /[35-9]/.test(n)) {
      v = Math.max(100, v);
    }
  }

  if (v >= 1000) return { priceNum: -1, text: "Liên hệ" };

  // Bảng tam hoa ô tô (giá sàn)
  if (kb == null && !moto && (tag & B["Tam hoa"]) && !(tag & (B["Tứ quý"] | B["Ngũ quý"]))) {
    const tailMatch = n.match(/(\d)\1\1$/), headMatch = n.match(/^(\d)\1\1/);
    const digit = (tailMatch || headMatch || [])[1];
    if (digit === "1" || digit === "4") v = 79;
    else if (digit === "2") v = 99;
    else if (digit === "3" || digit === "5" || digit === "7") {
      v = digit === "7" ? (v >= 109 ? 109 : v >= 99 ? 99 : 89) : (v >= 119 ? 119 : v >= 109 ? 109 : 99);
    }
    if (hv != null && hv > v) v = hv;
  }

  return formatGiaValue(v);
}

function formatGiaValue(v) {
  if (v == null || v <= 0) return { priceNum: -1, text: "Liên hệ" };
  if (v === -1 || v >= 1000) return { priceNum: -1, text: "Liên hệ" };
  const d = v % 10;
  const rounded = (d === 0 || d === 5 || d === 9) ? v : v - d + 9;
  return {
    priceNum: rounded,
    text: rounded >= 1000 ? (rounded / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " tỷ" : rounded + " tr"
  };
}

/* ===== TELEGRAM BOT HELPER ===== */
function sendTelegram(method, payload) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const req = https.request(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': data.length
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendTelegramPhoto(chatId, imageBuffer, caption) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const postData = [];

    // chat_id
    postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`));

    // caption
    if (caption) {
      postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
    }

    // photo
    postData.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="bienso.png"\r\nContent-Type: image/png\r\n\r\n`));
    postData.push(imageBuffer);
    postData.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const fullPayload = Buffer.concat(postData);

    const req = https.request(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullPayload.length
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { resolve(body); }
      });
    });
    req.on('error', reject);
    req.write(fullPayload);
    req.end();
  });
}

/* ===== GHÉP ẢNH CHUẨN ĐẤU GIÁ 186 ===== */
function tryParsePlate(text) {
  if (!text) return null;
  let clean = text.replace(/^(?:ảnh\s*trúng\s*đấu\s*giá|anh\s*trung\s*dau\s*gia|trúng\s*đấu\s*giá|trung\s*dau\s*gia|ghép\s*ảnh|ghep\s*anh|ghép|ghep|mẫu\s*1|mau\s*1|mẫu\s*2|mau\s*2)\s*/i, '').trim();

  // Bóc tách thêm bước giá nếu có: "30M-688.68 bước giá 10tr"
  let buocGia = "";
  const bgMatch = clean.match(/(?:bước\s*giá|buoc\s*gia)\s*[:=]?\s*([0-9.,]+(?:\s*(?:tr|trieu|triệu|k|nghin))?)/i);
  if (bgMatch) {
    buocGia = bgMatch[1].trim();
    clean = clean.replace(bgMatch[0], '').trim();
  }

  // 1. Có dấu chấm hoặc gạch nối: 30D-668.66, 30M 688.68
  let m = clean.match(/(\d{2}[A-Za-z]{1,2})\s*[-.]?\s*(\d{2,3})\s*[-.]\s*(\d{2,3})/);
  if (m) {
    const head = m[1].toUpperCase();
    const fullDigits = m[2] + m[3];
    if (fullDigits.length === 5) {
      return { head, tail: fullDigits.slice(0, 3) + '.' + fullDigits.slice(3), buocGia };
    } else if (fullDigits.length === 4) {
      return { head, tail: fullDigits.slice(0, 2) + '.' + fullDigits.slice(2), buocGia };
    }
  }

  // 2. Viết liền 5 số: 29K39939, 30M 68868, 30D66866
  let m2 = clean.match(/(\d{2}[A-Za-z]{1,2})\s*[-.]?\s*(\d{5})/);
  if (m2) {
    const head = m2[1].toUpperCase();
    const n5 = m2[2];
    return { head, tail: n5.slice(0, 3) + '.' + n5.slice(3), buocGia };
  }

  // 3. Viết liền 4 số
  let m3 = clean.match(/(\d{2}[A-Za-z]{1,2})\s*[-.]?\s*(\d{4})/);
  if (m3) {
    const head = m3[1].toUpperCase();
    const n4 = m3[2];
    return { head, tail: n4.slice(0, 2) + '.' + n4.slice(2), buocGia };
  }

  return null;
}

function renderVectorText(text, cx, cy, targetH, fill) {
  fill = fill || "#0a0a0a";
  const glyphs = (templates && templates.GLYPHS) ? templates.GLYPHS : null;
  if (!glyphs) return '';

  const s = targetH / 72.8;
  const chars = String(text || "").toUpperCase();

  let curX = 0;
  const items = [];
  let minBx = Infinity, maxBx = -Infinity, minBy = Infinity, maxBy = -Infinity;

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === ' ') {
      curX += 28 * s;
      continue;
    }
    const g = glyphs[c];
    if (!g) continue;

    const gx = curX;
    const gMinX = gx + (g.bx * s);
    const gMaxX = gMinX + (g.bw * s);
    const gMinY = g.by * s;
    const gMaxY = gMinY + (g.bh * s);

    if (gMinX < minBx) minBx = gMinX;
    if (gMaxX > maxBx) maxBx = gMaxX;
    if (gMinY < minBy) minBy = gMinY;
    if (gMaxY > maxBy) maxBy = gMaxY;

    items.push({ g, x: gx });
    curX += (g.w + 1.5) * s;
  }

  if (items.length === 0) return '';

  const strW = maxBx - minBx;
  const strH = maxBy - minBy;
  const startX = cx - (strW / 2) - minBx;
  const startY = cy - (strH / 2) - minBy;

  let paths = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const tx = startX + item.x;
    const ty = startY;
    paths += `<path d="${item.g.d}" transform="translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) scale(${s.toFixed(5)})" fill="${fill}" />\n`;
  }
  return paths;
}

// MẪU 1: CÔ GÁI CẦM BIỂN XE MERCEDES (CHIA 2 DÒNG CHUẨN ĐẸP NHƯ ẢNH MẪU 2)
async function renderMau1(head, tail) {
  if (!templates || !templates.b64Mau1) return null;
  const bg = Buffer.from(templates.b64Mau1, 'base64');

  // Vector path rendering chuẩn xác 2 dòng như ảnh mẫu:
  // Dòng 1: Mã biển (ví dụ: 51M, 66A, 29K) - Tâm X=505, Y=608, Cao 62px
  const svgL1 = renderVectorText(head, 505, 608, 62, "#0e0e0e");

  // Dòng 2: Dãy số (ví dụ: 616.66, 666.66, 399.39) - Tâm X=505, Y=698, Cao 80px
  const svgL2 = renderVectorText(tail, 505, 698, 80, "#0e0e0e");

  const svg = `
  <svg width="1024" height="838" xmlns="http://www.w3.org/2000/svg">
    <!-- Che phần giữa biển bằng màu nhôm xám trắng tự nhiên #F0EFF5 của biển số -->
    <rect x="290" y="556" width="430" height="206" rx="6" ry="6" fill="#f0eff5"/>
    ${svgL1}
    ${svgL2}
  </svg>`;

  if (sharpLib) {
    try {
      return await sharpLib(bg)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer();
    } catch (e) {
      console.error("Sharp Mau 1 failed:", e.message);
    }
  }

  return null;
}

// MẪU 2: BANNER ĐỎ TRÚNG ĐẤU GIÁ (CÂN ĐỐI 100% THEO CHUẨN ẢNH MẪU 1)
async function renderMau2(head, tail, buocGia) {
  if (!templates || !templates.b64Mau2) return null;
  const bg = Buffer.from(templates.b64Mau2, 'base64');

  // Cân đối lại kích thước font chữ chuẩn tỉ lệ và cân xứng với khung biển số
  // Dòng 1: Mã biển (ví dụ: 30M, 30K) - Tâm X=511, Y=355, Cao 82px
  const svgL1 = renderVectorText(head, 511, 355, 82, "#0a0a0a");

  // Dòng 2: Dãy số (ví dụ: 688.68, 668.66) - Tâm X=511, Y=485, Cao 115px
  const svgL2 = renderVectorText(tail, 511, 485, 115, "#0a0a0a");

  const svg = `
  <svg width="1024" height="892" xmlns="http://www.w3.org/2000/svg">
    <!-- Che vùng chữ cũ bên trong biển trắng (khung chuẩn không lẹm viền) -->
    <rect x="235" y="270" width="555" height="315" fill="#ffffff"/>
    ${svgL1}
    ${svgL2}
  </svg>`;

  if (sharpLib) {
    try {
      return await sharpLib(bg)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer();
    } catch (e) {
      console.error("Sharp Mau 2 error:", e.message);
    }
  }

  return null;
}

/* ===== PARSE FILTER TIÊU CHÍ ===== */
function parseSingleFilter(rawText) {
  const p = {
    raw: rawText,
    head: '',
    tail: '',
    prov: '',
    fmt: '',
    type: -1,
    menh: '',
    nut: 0,
    status: 0, // 0: tất cả, 1: đã có lịch (sắp đấu), 2: chưa có lịch
    minPrice: 0,
    maxPrice: 0,
    avoids: []
  };

  let t = removeAccents(rawText).toLowerCase();

  // Danh mục trạng thái lịch
  if (/da co lich|co lich|sap dau|lich dau/.test(t)) {
    p.status = 1;
    t = t.replace(/da co lich|co lich|sap dau|lich dau/g, ' ');
  } else if (/chua co lich|chua lich/.test(t)) {
    p.status = 2;
    t = t.replace(/chua co lich|chua lich/g, ' ');
  }

  // Loại xe
  if (/xe may|\bxm\b/.test(t)) { p.type = 1; t = t.replace(/xe may|\bxm\b/g, ' '); }
  else if (/o to|oto|xe hoi/.test(t)) { p.type = 0; t = t.replace(/o to|oto|xe hoi/g, ' '); }

  // Tỉnh thành
  if (/ha noi|\bhn\b/.test(t)) { p.prov = "Hà Nội"; t = t.replace(/ha noi|\bhn\b/g, ' '); }
  else if (/sai gon|ho chi minh|\bhcm\b|\bsg\b/.test(t)) { p.prov = "Hồ Chí Minh"; t = t.replace(/sai gon|ho chi minh|\bhcm\b|\bsg\b/g, ' '); }
  else if (/hai phong|\bhp\b/.test(t)) { p.prov = "Hải Phòng"; t = t.replace(/hai phong|\bhp\b/g, ' '); }
  else if (/da nang|\bdn\b/.test(t)) { p.prov = "Đà Nẵng"; t = t.replace(/da nang|\bdn\b/g, ' '); }
  else if (/bac ninh|\bbn\b/.test(t)) { p.prov = "Bắc Ninh"; t = t.replace(/bac ninh|\bbn\b/g, ' '); }
  else if (/quang ninh|\bqn\b/.test(t)) { p.prov = "Quảng Ninh"; t = t.replace(/quang ninh|\bqn\b/g, ' '); }
  else if (/thanh hoa|\bth\b/.test(t)) { p.prov = "Thanh Hóa"; t = t.replace(/thanh hoa|\bth\b/g, ' '); }
  else if (/nghe an|\bna\b/.test(t)) { p.prov = "Nghệ An"; t = t.replace(/nghe an|\bna\b/g, ' '); }
  else if (/hung yen|\bhy\b/.test(t)) { p.prov = "Hưng Yên"; t = t.replace(/hung yen|\bhy\b/g, ' '); }

  // Tài chính / giá tiền
  const mRangePrice = t.match(/(\d+)\s*(?:-|den|đến)\s*(\d+)\s*(?:tr|trieu|triệu|cu|củ)?/);
  if (mRangePrice) {
    p.minPrice = parseFloat(mRangePrice[1]);
    p.maxPrice = parseFloat(mRangePrice[2]);
    t = t.replace(mRangePrice[0], ' ');
  } else {
    const mTam = t.match(/(?:tam|khoang|quanh)\s*(\d+)\s*(?:tr|trieu|triệu|cu|củ)/);
    if (mTam) {
      const val = parseFloat(mTam[1]);
      p.minPrice = Math.max(0, val * 0.7);
      p.maxPrice = val * 1.25;
      t = t.replace(mTam[0], ' ');
    } else {
      const mSinglePrice = t.match(/(?:tai chinh|duoi|toi da|tam gia)?\s*(\d+)\s*(?:tr|trieu|triệu|cu|củ)/);
      if (mSinglePrice) {
        const val = parseFloat(mSinglePrice[1]);
        p.minPrice = 0; // Đặt 0 để lấy toàn bộ biển trong tầm ngân sách (không loại mất biển rẻ hơn)
        p.maxPrice = val * 1.15;
        t = t.replace(mSinglePrice[0], ' ');
      }
    }
  }

  // Dạng số phong thủy
  if (/ngu quy/.test(t)) { p.fmt = "ngu-quy"; t = t.replace(/ngu quy/g, ' '); }
  else if (/tu quy/.test(t)) { p.fmt = "tu-quy"; t = t.replace(/tu quy/g, ' '); }
  else if (/tam hoa/.test(t)) { p.fmt = "tam-hoa"; t = t.replace(/tam hoa/g, ' '); }
  else if (/sanh tien|sanh/.test(t)) { p.fmt = "sanh-tien"; t = t.replace(/sanh tien|sanh/g, ' '); }
  else if (/loc phat/.test(t)) { p.fmt = "loc-phat"; t = t.replace(/loc phat/g, ' '); }
  else if (/than tai/.test(t)) { p.fmt = "than-tai"; t = t.replace(/than tai/g, ' '); }
  else if (/ong dia/.test(t)) { p.fmt = "ong-dia"; t = t.replace(/ong dia/g, ' '); }

  // Mệnh
  if (/menh kim/.test(t)) { p.menh = "Kim"; t = t.replace(/menh kim/g, ' '); }
  else if (/menh moc/.test(t)) { p.menh = "Mộc"; t = t.replace(/menh moc/g, ' '); }
  else if (/menh thuy/.test(t)) { p.menh = "Thủy"; t = t.replace(/menh thuy/g, ' '); }
  else if (/menh hoa/.test(t)) { p.menh = "Hỏa"; t = t.replace(/menh hoa/g, ' '); }
  else if (/menh tho/.test(t)) { p.menh = "Thổ"; t = t.replace(/menh tho/g, ' '); }

  // Tránh số
  const mAvoid = t.match(/(?:tranh|bo|khong lay|khong co)\s*([0-9\s,]+)/);
  if (mAvoid) {
    const digits = mAvoid[1].replace(/[^0-9]/g, '');
    for (const d of digits) p.avoids.push(parseInt(d, 10));
    t = t.replace(mAvoid[0], ' ');
  }

  // Đầu biển (30N, 30K, 29A...)
  const mHead = t.match(/\b(\d{2}[a-z]{1,2})\b/);
  if (mHead) {
    p.head = mHead[1].toUpperCase();
    t = t.replace(mHead[0], ' ');
  }

  // Đuôi số
  const mDuoi = t.match(/(?:duoi|dit|ket thuc)\s*([0-9]{2,5})/);
  if (mDuoi) {
    p.tail = mDuoi[1];
    t = t.replace(mDuoi[0], ' ');
  } else {
    const mNum = t.match(/\b([0-9]{2,5})\b/);
    if (mNum) {
      p.tail = mNum[1];
      t = t.replace(mNum[0], ' ');
    }
  }

  return p;
}

function parseMultiFilter(rawText) {
  const parts = rawText.split(/\bhoặc\b|\bhay\b|\bhoac\b|\/|\|/i);
  const filters = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      filters.push(parseSingleFilter(trimmed));
    }
  }
  return filters.length > 0 ? filters : [parseSingleFilter(rawText)];
}

const userStates = new Map();

function executeMultiFilter(chatId, filters, isMore, rawOriginal) {
  let state = userStates.get(chatId);
  if (!state) {
    state = { excludedKeys: new Set(), lastFilters: filters, lastRaw: rawOriginal };
    userStates.set(chatId, state);
  }
  if (!isMore) {
    state.excludedKeys.clear();
    state.lastFilters = filters;
    state.lastRaw = rawOriginal;
  }

  const start = Date.now();
  const todayInt = getTodayInt();
  const results = [];

  for (const p of filters) {
    let mask = 0;
    if (p.fmt === "ngu-quy") mask |= B["Ngũ quý"];
    else if (p.fmt === "tu-quy") mask |= B["Tứ quý"];
    else if (p.fmt === "tam-hoa") mask |= B["Tam hoa"];
    else if (p.fmt === "sanh-tien") mask |= B["Sảnh tiến"];
    else if (p.fmt === "loc-phat") mask |= B["Lộc phát"];
    else if (p.fmt === "than-tai") mask |= B["Thần tài"];
    else if (p.fmt === "ong-dia") mask |= B["Ông địa"];

    for (let i = 0; i < storage.plates.length; i++) {
      const item = storage.plates[i];
      if (p.type >= 0 && item.moto !== p.type) continue;
      if (mask && !(item.tag & mask)) continue;

      const prefix = storage.prefixes[item.pIdx];
      if (isYellowPlate(prefix)) continue; // Tuyệt đối loại bỏ biển vàng
      if (p.head && !prefix.startsWith(p.head)) continue;

      const prov = provOf(prefix.slice(0, 2));
      if (p.prov && prov !== p.prov) continue;

      const numStr = pad5(item.num);
      if (p.tail && !numStr.endsWith(p.tail)) continue;

      // Lọc theo danh mục trạng thái
      if (p.status === 1) { // Đã có lịch (sắp tới)
        if (item.date < todayInt) continue;
      } else if (p.status === 2) { // Chưa có lịch
        if (item.date > 0) continue;
      }

      if (p.menh && !menhOk(item.num, p.menh)) continue;
      if (p.nut > 0 && item.nut !== p.nut) continue;

      if (p.avoids.length > 0) {
        let hasAvoid = false;
        for (const d of p.avoids) {
          if (numStr.includes(String(d))) { hasAvoid = true; break; }
        }
        if (hasAvoid) continue;
      }

      // Tính giá chuẩn theo web
      const price = calculatePrice(prefix, item.num, item.moto, item.tag);
      if (p.maxPrice > 0 && price.priceNum > 0) {
        if (price.priceNum > p.maxPrice) continue;
        if (p.minPrice > 0 && price.priceNum < p.minPrice) continue;
      }

      const key = prefix + numStr;
      if (state.excludedKeys.has(key)) continue;

      results.push({
        prefix,
        num: item.num,
        moto: item.moto,
        tag: item.tag,
        date: item.date,
        dateShort: item.dateShort,
        price
      });
      state.excludedKeys.add(key);
      if (results.length >= 18) break;
    }

    if (results.length >= 18) break;
  }

  const elapsed = Date.now() - start;

  if (results.length === 0) {
    if (isMore) {
      sendTelegram('sendMessage', {
        chat_id: chatId,
        text: '⚠️ <b>Đã hết biển phù hợp</b> với tiêu chí này trong kho. Bạn thử đổi điều kiện lọc khác nhé!',
        parse_mode: 'HTML'
      });
    } else {
      sendTelegram('sendMessage', {
        chat_id: chatId,
        text: `❌ <b>Không tìm thấy biển nào</b> phù hợp với yêu cầu: <i>${rawOriginal}</i>.\n\n💡 <i>Mẹo: Gõ cú pháp ngắn như: <code>30N đuôi 68</code>, <code>đuôi 368 hà nội</code>, <code>đã có lịch hà nội</code></i>`,
        parse_mode: 'HTML'
      });
    }
    return;
  }

  let titleHeader = isMore ? "🔄 <b>DANH SÁCH BIỂN TIẾP THEO:</b>\n" : "🚗 <b>KẾT QUẢ LỌC BIỂN TỪ KHO KHOBIENPHONGTHUY.VN</b>\n";
  if (filters[0] && filters[0].status === 1) {
    titleHeader = "⏰ <b>DANH SÁCH BIỂN ĐÃ CÓ LỊCH ĐẤU (SẮP ĐẤU):</b>\n";
  } else if (filters[0] && filters[0].status === 2) {
    titleHeader = "📋 <b>DANH SÁCH BIỂN CHƯA CÓ LỊCH ĐẤU:</b>\n";
  }

  let text = titleHeader;
  text += `⏱ <i>Tốc độ lọc: ${elapsed} ms | Tìm thấy: ${results.length} biển</i>\n`;
  text += `────────────────────────\n`;

  results.forEach((item, idx) => {
    const s = pad5(item.num);
    const plateText = `${item.prefix}-${s.slice(0, 3)}.${s.slice(3)}`;
    const motoIcon = item.moto ? "🛵" : "🚘";
    const dateSuffix = (item.dateShort && item.date >= todayInt) ? ` (Đấu ${item.dateShort})` : "";
    // Định dạng rút gọn sạch sẽ: "1. 30D-888.39 🚘 290 tr (Đấu 16/11)"
    text += `<b>${idx + 1}.</b> <code>${plateText}</code> ${motoIcon} <b>${item.price.text}</b>${dateSuffix}\n`;
  });

  text += `────────────────────────\n`;
  text += `📞 Hotline/Zalo hỗ trợ chốt biển: <b>0888.188.888</b>`;

  sendTelegram('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[{ text: '🔄 Lọc thêm biển khác (15-20 biển)', callback_data: 'more' }]]
    }
  });
}

/* ===== TRA CỨU BIỂN ĐÃ ĐẤU ===== */
function handleLookupDaDau(chatId, textInput) {
  const plate = tryParsePlate(textInput);
  if (!plate) {
    sendTelegram('sendMessage', {
      chat_id: chatId,
      text: `🔍 <b>TRA CỨU BIỂN SỐ ĐÃ ĐẤU GIÁ</b>\n────────────────────────\nVui lòng nhập biển số cụ thể để tra cứu giá trúng và ngày đấu.\n\n👉 <i>Ví dụ gõ:</i>\n• <code>đã đấu 30K-888.88</code>\n• <code>check 51K-999.99</code>\n• <code>giá trúng 30D-668.66</code>`,
      parse_mode: 'HTML'
    });
    return;
  }

  const rawHead = plate.head;
  const rawTail = plate.tail.replace('.', '');
  const provName = provOf(rawHead.slice(0, 2));
  const isHN = HN_CODES.has(rawHead.slice(0, 2));

  let priceText = "Liên hệ";
  let dateText = "Đã đấu giá thành công";

  if (giaData) {
    const fullPlate = rawHead + rawTail;
    if (giaData.p && giaData.p[fullPlate] != null) {
      priceText = formatGiaValue(giaData.p[fullPlate]).text;
    } else if (giaData.t && giaData.t[rawTail]) {
      const pArr = giaData.t[rawTail];
      const val = pArr[isHN ? 0 : 1];
      if (val > 0) priceText = val + " tr (Giá trúng trung bình VPA)";
    } else if (giaData.rieng && giaData.rieng[rawTail]) {
      const rVal = giaData.rieng[rawTail][isHN ? 0 : 1];
      if (rVal > 0) priceText = rVal + " tr";
    }
  }

  const reply = `🎯 <b>KẾT QUẢ TRA CỨU BIỂN ĐÃ ĐẤU:</b>
────────────────────────
🚗 <b>Biển số:</b> <code>${plate.head}-${plate.tail}</code>
📍 <b>Tỉnh thành:</b> ${provName}
💰 <b>Giá trúng tham khảo:</b> <b>${priceText}</b>
📅 <b>Trạng thái:</b> ${dateText}
────────────────────────
💡 <i>Hotline hỗ trợ hồ sơ, định danh & chuyển nhượng xe trúng đấu giá:</i>
📞 <b>0888.188.888</b>`;

  sendTelegram('sendMessage', {
    chat_id: chatId,
    text: reply,
    parse_mode: 'HTML'
  });
}

const userSessions = new Map(); // chatId -> { mode: 'colich' | 'chuacolich' | 'dadau' | 'ghep' | 'mau1' }

/* ===== POLLING LOOP ===== */
let offset = 0;
async function pollUpdates() {
  try {
    const res = await sendTelegram('getUpdates', { offset, timeout: 5 });
    if (res && res.result && Array.isArray(res.result)) {
      for (const update of res.result) {
        if (update.update_id >= offset) offset = update.update_id + 1;

        if (update.message && update.message.text && update.message.chat) {
          const chatId = update.message.chat.id;
          const msgText = update.message.text.trim();
          if (msgText.includes("KẾT QUẢ LỌC BIỂN")) continue;

          console.log(`MSG from ${chatId}: ${msgText}`);
          const tLower = removeAccents(msgText).toLowerCase();

          // 1. Menu nút bấm danh mục & Lệnh chuyển chế độ (Session Mode)
          if (tLower === "bien da co lich (sap dau)" || tLower === "bien da co lich" || tLower === "/colich" || tLower === "/dacolich") {
            userSessions.set(chatId, { mode: 'colich' });
            sendTelegram('sendMessage', {
              chat_id: chatId,
              text: `⏰ <b>CHẾ ĐỘ: LỌC BIỂN ĐÃ CÓ LỊCH ĐẤU (SẮP ĐẤU)</b>
────────────────────────
👉 <i>Hãy nhập tiêu chí bạn muốn tìm:</i>
• Ví dụ: <code>đuôi 79 hà nội</code>, <code>30N đuôi 68</code>, <code>tam hoa</code>, <code>tài chính 100tr</code>...

💡 <i>Mọi tìm kiếm bạn gửi sẽ tự động chỉ lọc trong danh sách các biển ĐÃ CÓ LỊCH ĐẤU để bạn copy gửi khách ngay!
(Gõ /start bất cứ lúc nào để về menu chính)</i>`,
              parse_mode: 'HTML'
            });
            continue;
          }

          if (tLower === "bien chua co lich" || tLower === "/chuacolich") {
            userSessions.set(chatId, { mode: 'chuacolich' });
            sendTelegram('sendMessage', {
              chat_id: chatId,
              text: `📋 <b>CHẾ ĐỘ: LỌC BIỂN CHƯA CÓ LỊCH ĐẤU</b>
────────────────────────
👉 <i>Hãy nhập tiêu chí bạn muốn tìm:</i>
• Ví dụ: <code>đuôi 79 hà nội</code>, <code>30N đuôi 68</code>, <code>thần tài</code>, <code>lộc phát</code>...

💡 <i>Mọi tìm kiếm bạn gửi sẽ tự động chỉ lọc các biển CHƯA CÓ LỊCH ĐẤU!
(Gõ /start bất cứ lúc nào để về menu chính)</i>`,
              parse_mode: 'HTML'
            });
            continue;
          }

          if (tLower === "tra cuu bien da dau" || tLower === "/dadau") {
            userSessions.set(chatId, { mode: 'dadau' });
            sendTelegram('sendMessage', {
              chat_id: chatId,
              text: `🔍 <b>CHẾ ĐỘ: TRA CỨU BIỂN SỐ ĐÃ ĐẤU GIÁ</b>
────────────────────────
👉 <i>Hãy nhập biển số cụ thể để tra cứu giá trúng & ngày đấu:</i>
• Ví dụ: <code>30K-888.88</code>, <code>30D-668.66</code>, <code>51K-999.99</code>...`,
              parse_mode: 'HTML'
            });
            continue;
          }

          if (tLower === "ghep banner trung dau gia" || tLower === "/ghep") {
            userSessions.set(chatId, { mode: 'ghep' });
            sendTelegram('sendMessage', {
              chat_id: chatId,
              text: `🖼 <b>CHẾ ĐỘ: GHÉP BANNER TRÚNG ĐẤU GIÁ (MẪU 2 CHUẨN 186)</b>
────────────────────────
👉 <i>Hãy nhập biển số bạn muốn ghép:</i>
• Ví dụ: <code>30K 68868</code>, <code>30D-668.66</code>, <code>30M-688.68 bước giá 10tr</code>

🏆 <i>Bot sẽ tự động xuất ảnh banner đỏ tia sáng chuẩn 100% như mẫu bot 186!</i>`,
              parse_mode: 'HTML'
            });
            continue;
          }

          if (tLower === "ghep mau 1 co gai" || tLower === "/mau1") {
            userSessions.set(chatId, { mode: 'mau1' });
            sendTelegram('sendMessage', {
              chat_id: chatId,
              text: `🚘 <b>CHẾ ĐỘ: GHÉP MẪU 1 (CÔ GÁI CẦM BIỂN XE MERCEDES)</b>
────────────────────────
👉 <i>Hãy nhập biển số bạn muốn ghép:</i>
• Ví dụ: <code>29K-399.39</code>, <code>30K-888.88</code>...

✨ <i>Bot sẽ tự động ghép vào biển số dài cô gái cầm trước xe Mercedes!</i>`,
              parse_mode: 'HTML'
            });
            continue;
          }

          if (tLower === "loc bien ngau nhien") {
            executeMultiFilter(chatId, [{ raw: "", head: "", tail: "", prov: "", fmt: "", type: -1, menh: "", nut: 0, status: 0, minPrice: 0, maxPrice: 0, avoids: [] }], false, "Biển ngẫu nhiên");
            continue;
          }

          // 2. Start / Help menu (Reset session mode)
          if (msgText === '/start' || msgText === '/help' || tLower === 'menu chinh') {
            userSessions.delete(chatId);
            sendTelegram('sendMessage', {
              chat_id: chatId,
              text: `👋 Chào mừng bạn đến với <b>Bot Kho Biển Phong Thủy</b> (khobienphongthuy.vn).

🔍 <b>LỌC BIỂN SỐ:</b>
• <code>đuôi 368 hà nội</code>
• <code>30N đuôi 68 hà nội</code>
• <code>tài chính 50-80 triệu tam hoa</code>

📂 <b>DANH MỤC TRẠNG THÁI:</b>
• <b>Biển đã có lịch:</b> <code>đã có lịch hà nội</code> (Sắp đấu tới, copy gửi khách)
• <b>Biển chưa có lịch:</b> <code>chưa có lịch 30N</code>
• <b>Biển đã đấu:</b> <code>đã đấu 30K-888.88</code> (Tra cứu ngày trúng & giá trúng)

🖼 <b>GHÉP ẢNH TRÚNG ĐẤU GIÁ:</b>
• <code>ảnh trúng đấu giá 29K39939</code> ➔ Mẫu 1 (Cô gái cầm biển)
• <code>30M-688.68</code> hoặc <code>ghép 30M 68868</code> ➔ Mẫu 2 (Banner Đỏ Trúng Đấu Giá)`,
              parse_mode: 'HTML',
              reply_markup: {
                keyboard: [
                  [{ text: '⏰ Biển đã có lịch (Sắp đấu)' }, { text: '📋 Biển chưa có lịch' }],
                  [{ text: '🔍 Tra cứu biển đã đấu' }, { text: '🔄 Lọc biển ngẫu nhiên' }]
                ],
                resize_keyboard: true
              }
            });
            continue;
          }

          const currentSession = userSessions.get(chatId);

          // 3. Nếu đang ở chế độ Tra cứu đã đấu
          if (currentSession && currentSession.mode === 'dadau') {
            handleLookupDaDau(chatId, msgText);
            continue;
          }
          if (tLower.startsWith("da dau") || tLower.startsWith("check") || tLower.startsWith("gia trung") || tLower.startsWith("tra cuu")) {
            handleLookupDaDau(chatId, msgText);
            continue;
          }

          // 4. Lệnh ghép ảnh Mẫu 1 (Cô gái cầm biển dài trước xe Mercedes)
          const isModeMau1 = currentSession && currentSession.mode === 'mau1';
          if (isModeMau1 || tLower.includes("anh trung dau gia") || tLower.includes("trung dau gia") || tLower.startsWith("mau 1")) {
            const plate = tryParsePlate(msgText);
            if (plate) {
              sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `⏳ Đang ghép biển <b>${plate.head} - ${plate.tail}</b> vào Mẫu 1 (Cô gái cầm biển)...`,
                parse_mode: 'HTML'
              });
              try {
                const imgBuf = await renderMau1(plate.head, plate.tail);
                if (imgBuf) {
                  await sendTelegramPhoto(chatId, imgBuf, `🏆 CHÚC MỪNG TRÚNG ĐẤU GIÁ BIỂN SỐ: ${plate.head}-${plate.tail}`);
                  continue;
                }
              } catch (exRender) {
                console.error("Render Mau 1 error:", exRender);
              }
            }
          }

          // 5. Lệnh ghép ảnh Mẫu 2 (Banner Đỏ Trúng Đấu Giá chuẩn 186)
          const isModeGhep = currentSession && currentSession.mode === 'ghep';
          const isExplicitGhep = tLower.startsWith("ghep") || tLower.startsWith("mau 2");
          const isPurePlate = /^\s*(\d{2}[A-Za-z]{1,2})\s*[-.]?\s*(\d{4,5}|\d{2,3}[-.]\d{2})(?:\s*(?:bước\s*giá|buoc\s*gia)?\s*[:=]?\s*[0-9.,]+(?:\s*(?:tr|trieu|triệu|k|nghin))?)?\s*$/i.test(msgText);

          if (isModeGhep || isExplicitGhep || isPurePlate) {
            const plate = tryParsePlate(msgText);
            if (plate) {
              sendTelegram('sendMessage', {
                chat_id: chatId,
                text: `⏳ Đang ghép biển <b>${plate.head}\n${plate.tail}</b> vào Mẫu 2 (Banner Trúng Đấu Giá chuẩn 186)...`,
                parse_mode: 'HTML'
              });
              try {
                const imgBuf = await renderMau2(plate.head, plate.tail, plate.buocGia);
                if (imgBuf) {
                  await sendTelegramPhoto(chatId, imgBuf, `🏆 CHÚC MỪNG TRÚNG ĐẤU GIÁ BIỂN SỐ: ${plate.head}-${plate.tail}`);
                  continue;
                }
              } catch (exRender) {
                console.error("Render Mau 2 error:", exRender);
              }
            }
          }

          // 6. Lọc thông thường hoặc theo danh mục đang chọn
          const filters = parseMultiFilter(msgText);

          // Tự động kế thừa chế độ danh mục nếu người dùng đang ở chế độ đó
          if (currentSession && currentSession.mode === 'colich') {
            for (const f of filters) {
              if (f.status === 0) f.status = 1; // Ép chỉ lọc biển ĐÃ CÓ LỊCH ĐẤU
            }
          } else if (currentSession && currentSession.mode === 'chuacolich') {
            for (const f of filters) {
              if (f.status === 0) f.status = 2; // Ép chỉ lọc biển CHƯA CÓ LỊCH
            }
          }

          executeMultiFilter(chatId, filters, false, msgText);
        }

        if (update.callback_query && update.callback_query.data === 'more') {
          const cb = update.callback_query;
          sendTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đang lọc thêm 15-20 biển mới...' });
          if (cb.message && cb.message.chat) {
            const chatId = cb.message.chat.id;
            const state = userStates.get(chatId);
            if (state && state.lastFilters) {
              executeMultiFilter(chatId, state.lastFilters, true, state.lastRaw || "");
            } else {
              sendTelegram('sendMessage', { chat_id: chatId, text: 'Vui lòng nhập lại tiêu chí lọc mới.' });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Poll error:", err.message);
  }

  setTimeout(pollUpdates, 300);
}

async function registerBotCommands() {
  try {
    await sendTelegram('setMyCommands', {
      commands: [
        { command: 'start', description: '🏠 Menu chính & Hướng dẫn sử dụng' },
        { command: 'colich', description: '⏰ Danh sách biển đã có lịch đấu' },
        { command: 'chuacolich', description: '📋 Danh sách biển chưa có lịch' },
        { command: 'dadau', description: '🔍 Tra cứu biển đã đấu & Giá trúng' },
        { command: 'ghep', description: '🖼 Ghép banner Đỏ Trúng Đấu Giá' },
        { command: 'mau1', description: '🚘 Ghép Mẫu 1 Cô gái cầm biển dài' },
        { command: 'help', description: '💡 Hướng dẫn cú pháp lọc biển' }
      ]
    });
    console.log("Đã đăng ký Menu lệnh Bot Telegram thành công.");
  } catch (e) {
    console.error("Lỗi đăng ký lệnh:", e.message);
  }
}

// Bắt đầu chạy bot
(async () => {
  await registerBotCommands();
  await loadData();
  setInterval(loadData, 6 * 3600 * 1000); // Tự động cập nhật kho mỗi 6 tiếng
  pollUpdates();
})();
