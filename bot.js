const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN || '8917031192:AAEp-UxhwMKsFeWojBrrjC8x0DOZi1sOx4w';
const PORT = process.env.PORT || 10000;

/* ===== BỘ MÁY PHONG THỦY ===== */
const FMT_ORDER = ["Ngũ quý","Tứ quý","Tứ quý đầu","Tứ quý đuôi","Sảnh tiến","Tam hoa","Lộc phát","Thần tài","Ông địa","Đuôi 99","Đuôi 89","Năm sinh","ABAB","ABBA","AABB","Đối xứng","Kép đuôi","Số đẹp"];
const FMT_RANK = [10,9,9,9,8,7,5,5,4,4,3,4,6,6,6,5,3,1];
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

/* ===== KHO BIỂN (PACKED TYPED ARRAYS) ===== */
const storage = {
  prefixes: [],
  plates: [], // { preIdx, num, tag, nut, moto }
  giaMap: new Map(),
  defaultGiaMap: new Map()
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
    let giaData = null;
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

    // Nạp giá
    if (giaData && giaData.gia) {
      for (const k in giaData.gia) storage.giaMap.set(k.toUpperCase(), giaData.gia[k]);
    }
    if (giaData && giaData.default) {
      for (const k in giaData.default) storage.defaultGiaMap.set(k, giaData.default[k]);
    }

    // Nạp biển (cấu trúc mảng rows trong live.json)
    storage.prefixes = [];
    storage.plates = [];
    const preMap = new Map();

    if (liveData && Array.isArray(liveData.rows)) {
      console.log(`Đang xử lý ${liveData.rows.length} biển từ live.json...`);
      for (let i = 0; i < liveData.rows.length; i++) {
        const row = liveData.rows[i];
        const raw = row[0]; // Ví dụ: "30D88888", "30N02468"
        const reg = raw.match(/^(\d{2}[A-Z][A-Z0-9]?)(\d{5})$/);
        if (!reg) continue;

        const prefix = reg[1];
        const num = parseInt(reg[2], 10);
        const moto = row[2] ? 1 : 0;

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
          moto
        });
      }
    }
    console.log(`ĐÃ NẠP THÀNH CÔNG ${storage.plates.length} BIỂN SỐ VÀO HỆ THỐNG!`);
  } catch (err) {
    console.error("Lỗi nạp kho:", err);
  }
}

// Khởi chạy Web Server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<h1>KhoBienPhongThuy Bot is running 24/7!</h1><p>Đã nạp thành công <b>${storage.plates.length}</b> biển số vào hệ thống.</p>`);
});
server.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

function getPriceNumber(prefix, num, moto) {
  const pStr = prefix + "-" + pad5(num);
  if (storage.giaMap.has(pStr)) return parseFloat(storage.giaMap.get(pStr)) || 0;

  const d = Math.floor(num / 10) % 10, e = num % 10;
  const l2 = d * 10 + e;
  let form = "khac";
  if (l2 === 68 || l2 === 86) form = "loc-phat";
  else if (l2 === 39 || l2 === 79) form = "than-tai";
  else if (l2 === 38 || l2 === 78) form = "ong-dia";
  else {
    const a = Math.floor(num / 10000), b = Math.floor(num / 1000) % 10, c = Math.floor(num / 100) % 10;
    if (a===b && b===c && c===d && d===e) form = "ngu-quy";
    else if ((b===c && c===d && d===e) || (a===b && b===c && c===d)) form = "tu-quy";
    else if ((c===d && d===e) || (a===b && b===c)) form = "tam-hoa";
  }

  const defKey = (moto ? "xemay_" : "oto_") + form;
  if (storage.defaultGiaMap.has(defKey)) return parseFloat(storage.defaultGiaMap.get(defKey)) || 0;
  return 0;
}

function formatPrice(prefix, num, moto) {
  const pStr = prefix + "-" + pad5(num);
  if (storage.giaMap.has(pStr)) return storage.giaMap.get(pStr) + " tr";

  const d = Math.floor(num / 10) % 10, e = num % 10;
  const l2 = d * 10 + e;
  let form = "khac";
  if (l2 === 68 || l2 === 86) form = "loc-phat";
  else if (l2 === 39 || l2 === 79) form = "than-tai";
  else if (l2 === 38 || l2 === 78) form = "ong-dia";
  else {
    const a = Math.floor(num / 10000), b = Math.floor(num / 1000) % 10, c = Math.floor(num / 100) % 10;
    if (a===b && b===c && c===d && d===e) form = "ngu-quy";
    else if ((b===c && c===d && d===e) || (a===b && b===c && c===d)) form = "tu-quy";
    else if ((c===d && d===e) || (a===b && b===c)) form = "tam-hoa";
  }

  const defKey = (moto ? "xemay_" : "oto_") + form;
  if (storage.defaultGiaMap.has(defKey)) return storage.defaultGiaMap.get(defKey) + " tr";
  return "Liên hệ";
}

function mainTag(tag) {
  for (let i = 0; i < FMT_ORDER.length; i++) {
    if (tag & (1 << i)) return FMT_ORDER[i];
  }
  return "Số đẹp";
}

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

/* ===== PARSE SUB-FILTER ĐƠN LẺ ===== */
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
    minPrice: 0,
    maxPrice: 0,
    avoids: []
  };

  let t = removeAccents(rawText).toLowerCase();

  // 1. Loại xe
  if (/xe may|\bxm\b/.test(t)) { p.type = 1; t = t.replace(/xe may|\bxm\b/g, ' '); }
  else if (/o to|oto|xe hoi/.test(t)) { p.type = 0; t = t.replace(/o to|oto|xe hoi/g, ' '); }

  // 2. Tỉnh thành
  if (/ha noi|\bhn\b/.test(t)) { p.prov = "Hà Nội"; t = t.replace(/ha noi|\bhn\b/g, ' '); }
  else if (/sai gon|ho chi minh|\bhcm\b|\bsg\b/.test(t)) { p.prov = "Hồ Chí Minh"; t = t.replace(/sai gon|ho chi minh|\bhcm\b|\bsg\b/g, ' '); }
  else if (/hai phong|\bhp\b/.test(t)) { p.prov = "Hải Phòng"; t = t.replace(/hai phong|\bhp\b/g, ' '); }
  else if (/da nang|\bdn\b/.test(t)) { p.prov = "Đà Nẵng"; t = t.replace(/da nang|\bdn\b/g, ' '); }
  else if (/bac ninh|\bbn\b/.test(t)) { p.prov = "Bắc Ninh"; t = t.replace(/bac ninh|\bbn\b/g, ' '); }
  else if (/quang ninh|\bqn\b/.test(t)) { p.prov = "Quảng Ninh"; t = t.replace(/quang ninh|\bqn\b/g, ' '); }
  else if (/thanh hoa|\bth\b/.test(t)) { p.prov = "Thanh Hóa"; t = t.replace(/thanh hoa|\bth\b/g, ' '); }
  else if (/nghe an|\bna\b/.test(t)) { p.prov = "Nghệ An"; t = t.replace(/nghe an|\bna\b/g, ' '); }
  else if (/hung yen|\bhy\b/.test(t)) { p.prov = "Hưng Yên"; t = t.replace(/hung yen|\bhy\b/g, ' '); }

  // 3. Tài chính / giá tiền
  const mRangePrice = t.match(/(\d+)\s*(?:-|den|đến)\s*(\d+)\s*(?:tr|trieu|triệu|cu|củ)?/);
  if (mRangePrice) {
    p.minPrice = parseFloat(mRangePrice[1]);
    p.maxPrice = parseFloat(mRangePrice[2]);
    t = t.replace(mRangePrice[0], ' ');
  } else {
    const mSinglePrice = t.match(/(?:tai chinh|duoi|tam|khoang|tam gia)?\s*(\d+)\s*(?:tr|trieu|triệu|cu|củ)/);
    if (mSinglePrice) {
      const val = parseFloat(mSinglePrice[1]);
      p.minPrice = Math.max(0, val * 0.7);
      p.maxPrice = val * 1.15;
      t = t.replace(mSinglePrice[0], ' ');
    }
  }

  // 4. Dạng số phong thủy
  if (/ngu quy/.test(t)) { p.fmt = "ngu-quy"; t = t.replace(/ngu quy/g, ' '); }
  else if (/tu quy/.test(t)) { p.fmt = "tu-quy"; t = t.replace(/tu quy/g, ' '); }
  else if (/tam hoa/.test(t)) { p.fmt = "tam-hoa"; t = t.replace(/tam hoa/g, ' '); }
  else if (/sanh tien|sanh/.test(t)) { p.fmt = "sanh-tien"; t = t.replace(/sanh tien|sanh/g, ' '); }
  else if (/loc phat/.test(t)) { p.fmt = "loc-phat"; t = t.replace(/loc phat/g, ' '); }
  else if (/than tai/.test(t)) { p.fmt = "than-tai"; t = t.replace(/than tai/g, ' '); }
  else if (/ong dia/.test(t)) { p.fmt = "ong-dia"; t = t.replace(/ong dia/g, ' '); }

  // 5. Mệnh
  if (/menh kim/.test(t)) { p.menh = "Kim"; t = t.replace(/menh kim/g, ' '); }
  else if (/menh moc/.test(t)) { p.menh = "Mộc"; t = t.replace(/menh moc/g, ' '); }
  else if (/menh thuy/.test(t)) { p.menh = "Thủy"; t = t.replace(/menh thuy/g, ' '); }
  else if (/menh hoa/.test(t)) { p.menh = "Hỏa"; t = t.replace(/menh hoa/g, ' '); }
  else if (/menh tho/.test(t)) { p.menh = "Thổ"; t = t.replace(/menh tho/g, ' '); }

  // 6. Tránh số
  const mAvoid = t.match(/(?:tranh|bo|khong lay|khong co)\s*([0-9\s,]+)/);
  if (mAvoid) {
    const digits = mAvoid[1].replace(/[^0-9]/g, '');
    for (const d of digits) p.avoids.push(parseInt(d, 10));
    t = t.replace(mAvoid[0], ' ');
  }

  // 7. Đầu biển (30N, 30K, 29A...)
  const mHead = t.match(/\b(\d{2}[a-z]{1,2})\b/);
  if (mHead) {
    p.head = mHead[1].toUpperCase();
    t = t.replace(mHead[0], ' ');
  }

  // 8. Đuôi số
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

// Phân tích nhiều vế nếu người dùng gõ "hoặc", "hay", ","
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
      if (p.head && !prefix.startsWith(p.head)) continue;

      const prov = provOf(prefix.slice(0, 2));
      if (p.prov && prov !== p.prov) continue;

      const numStr = pad5(item.num);
      if (p.tail && !numStr.endsWith(p.tail)) continue;

      if (p.menh && !menhOk(item.num, p.menh)) continue;
      if (p.nut > 0 && item.nut !== p.nut) continue;

      if (p.avoids.length > 0) {
        let hasAvoid = false;
        for (const d of p.avoids) {
          if (numStr.includes(String(d))) { hasAvoid = true; break; }
        }
        if (hasAvoid) continue;
      }

      if (p.maxPrice > 0) {
        const priceNum = getPriceNumber(prefix, item.num, item.moto);
        if (priceNum > 0) {
          if (priceNum > p.maxPrice) continue;
          if (p.minPrice > 0 && priceNum < p.minPrice) continue;
        }
      }

      const key = prefix + numStr;
      if (state.excludedKeys.has(key)) continue;

      results.push({ prefix, num: item.num, moto: item.moto, tag: item.tag, prov });
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
        text: `❌ <b>Không tìm thấy biển nào</b> phù hợp với yêu cầu: <i>${rawOriginal}</i>.\n\n💡 <i>Mẹo: Gõ cú pháp ngắn như: <code>30N đuôi 68</code>, <code>đuôi 368 hà nội</code>, <code>Hà Nội lộc phát</code></i>`,
        parse_mode: 'HTML'
      });
    }
    return;
  }

  let text = isMore ? "🔄 <b>DANH SÁCH BIỂN TIẾP THEO (KHÔNG TRÙNG):</b>\n" : "🚗 <b>KẾT QUẢ LỌC BIỂN TỪ KHO KHOBIENPHONGTHUY.VN</b>\n";
  text += `⏱ <i>Tốc độ lọc: ${elapsed} ms | Tìm thấy: ${results.length} biển</i>\n`;
  text += `────────────────────────\n`;

  results.forEach((item, idx) => {
    const s = pad5(item.num);
    const plateText = `${item.prefix}-${s.slice(0, 3)}.${s.slice(3)}`;
    const price = formatPrice(item.prefix, item.num, item.moto);
    const tag = mainTag(item.tag);
    const motoIcon = item.moto ? "🛵" : "🚘";
    text += `<b>${idx + 1}.</b> <code>${plateText}</code> ${motoIcon} <b>${price}</b> | ${tag} • ${item.prov}\n`;
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
          if (msgText === '/start' || msgText === '/help') {
            sendTelegram('sendMessage', {
              chat_id: chatId,
              text: `👋 Chào mừng bạn đến với <b>Bot Lọc Biển Số Phong Thủy</b> (khobienphongthuy.vn).\n\n⚡ <b>Tốc độ lọc:</b> Dưới 1 giây.\n🎯 <b>Mỗi lần lọc:</b> 15 - 20 biển đẹp kèm giá tham khảo.\n🔄 <b>Lọc thêm:</b> Bấm nút xem tiếp các biển khác hoàn toàn không trùng lặp!\n\n💡 <i>Ví dụ:</i>\n• <code>đuôi 368 hà nội</code>\n• <code>30N đuôi 68 hà nội</code>\n• <code>tài chính 50-80 triệu tam hoa</code>`,
              parse_mode: 'HTML'
            });
            continue;
          }

          const filters = parseMultiFilter(msgText);
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

// Bắt đầu
(async () => {
  await loadData();
  setInterval(loadData, 6 * 3600 * 1000);
  pollUpdates();
})();
