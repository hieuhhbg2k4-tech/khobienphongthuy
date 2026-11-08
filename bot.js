const http = require('http');
const https = require('https');

const BOT_TOKEN = process.env.BOT_TOKEN || '8917031192:AAEp-UxhwMKsFeWojBrrjC8x0DOZi1sOx4w';
const PORT = process.env.PORT || 10000;

// Khởi chạy Web Server để Render giữ tiến trình online 24/7 (Free Tier)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<h1>KhoBienPhongThuy Bot is running 24/7!</h1><p>Đã nạp ${storage.plates.length} biển số.</p>`);
});
server.listen(PORT, () => {
  console.log(`Web server listening on port ${PORT}`);
});

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

/* ===== KHO BIỂN ===== */
const storage = {
  prefixes: [],
  plates: [], // { preIdx, num, tag, nut, moto }
  giaMap: new Map(), // "prefix-num" -> price
  defaultGiaMap: new Map()
};

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function loadData() {
  console.log("Đang tải dữ liệu từ web khobienphongthuy.vn...");
  try {
    const [giaData, liveData] = await Promise.all([
      fetchJson('https://khobienphongthuy.vn/assets/gia.json'),
      fetchJson('https://khobienphongthuy.vn/vpa-data/live.json')
    ]);

    // Nạp giá
    if (giaData.gia) {
      for (const k in giaData.gia) storage.giaMap.set(k.toUpperCase(), giaData.gia[k]);
    }
    if (giaData.default) {
      for (const k in giaData.default) storage.defaultGiaMap.set(k, giaData.default[k]);
    }

    // Nạp biển
    storage.prefixes = [];
    storage.plates = [];
    const preMap = new Map();

    const moto = liveData.kind === "moto" ? 1 : 0;
    for (const prefix in liveData.groups) {
      let pIdx = preMap.get(prefix);
      if (pIdx === undefined) {
        pIdx = storage.prefixes.length;
        preMap.set(prefix, pIdx);
        storage.prefixes.push(prefix);
      }
      const numStr = liveData.groups[prefix].n || '';
      for (let j = 0; j + 5 <= numStr.length; j += 5) {
        const num = parseInt(numStr.substr(j, 5), 10);
        storage.plates.push({
          pIdx,
          num,
          tag: classify(num),
          nut: nutOf(num),
          moto
        });
      }
    }
    console.log(`Đã nạp thành công ${storage.plates.length} biển từ web!`);
  } catch (err) {
    console.error("Lỗi tải dữ liệu kho:", err);
  }
}

// Format giá
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

function parseFilter(text) {
  const p = { raw: text, q: '', prov: '', fmt: '', type: -1, menh: '', nut: 0, avoids: '' };
  const t = removeAccents(text).toLowerCase();

  if (/xe may|\bxm\b/.test(t)) p.type = 1;
  else if (/o to|oto|xe hoi/.test(t)) p.type = 0;

  if (/ha noi|\bhn\b/.test(t)) p.prov = "Hà Nội";
  else if (/sai gon|ho chi minh|\bhcm\b|\bsg\b/.test(t)) p.prov = "Hồ Chí Minh";
  else if (/hai phong|\bhp\b/.test(t)) p.prov = "Hải Phòng";
  else if (/da nang|\bdn\b/.test(t)) p.prov = "Đà Nẵng";
  else if (/bac ninh|\bbn\b/.test(t)) p.prov = "Bắc Ninh";
  else if (/quang ninh|\bqn\b/.test(t)) p.prov = "Quảng Ninh";
  else if (/thanh hoa|\bth\b/.test(t)) p.prov = "Thanh Hóa";
  else if (/nghe an|\bna\b/.test(t)) p.prov = "Nghệ An";
  else if (/hung yen|\bhy\b/.test(t)) p.prov = "Hưng Yên";

  if (/ngu quy/.test(t)) p.fmt = "ngu-quy";
  else if (/tu quy/.test(t)) p.fmt = "tu-quy";
  else if (/tam hoa/.test(t)) p.fmt = "tam-hoa";
  else if (/sanh tien|sanh/.test(t)) p.fmt = "sanh-tien";
  else if (/loc phat/.test(t)) p.fmt = "loc-phat";
  else if (/than tai/.test(t)) p.fmt = "than-tai";
  else if (/ong dia/.test(t)) p.fmt = "ong-dia";
  else if (/dao|ganh/.test(t)) p.fmt = "dao-ganh";

  if (/menh kim/.test(t)) p.menh = "Kim";
  else if (/menh moc/.test(t)) p.menh = "Mộc";
  else if (/menh thuy/.test(t)) p.menh = "Thủy";
  else if (/menh hoa/.test(t)) p.menh = "Hỏa";
  else if (/menh tho/.test(t)) p.menh = "Thổ";

  const mNut = t.match(/(\d+)\s*(nut|diem)/);
  if (mNut) p.nut = parseInt(mNut[1], 10);

  const mAvoid = t.match(/(tranh|bo|khong lay|khong co)\s*([0-9\s,]+)/);
  if (mAvoid) p.avoids = mAvoid[2].replace(/\s+/g, '');

  const mDuoi = t.match(/(duoi|ket thuc|dit)\s*([0-9]{2,5})/);
  if (mDuoi) p.q = mDuoi[2];
  else {
    const mSub = t.match(/\b([0-9]{2,5})\b/);
    if (mSub) p.q = mSub[1];
  }

  const mHead = text.match(/\b(\d{2}[A-Z]{1,2})\b/i);
  if (mHead) {
    p.q = p.q ? (mHead[1].toUpperCase() + '-' + p.q) : mHead[1].toUpperCase();
  }

  return p;
}

const userStates = new Map();

function executeFilter(chatId, p, isMore) {
  let state = userStates.get(chatId);
  if (!state) {
    state = { excludedKeys: new Set(), lastP: p };
    userStates.set(chatId, state);
  }
  if (!isMore) {
    state.excludedKeys.clear();
    state.lastP = p;
  }

  const start = Date.now();
  let mask = 0;
  if (p.fmt === "ngu-quy") mask |= B["Ngũ quý"];
  else if (p.fmt === "tu-quy") mask |= B["Tứ quý"];
  else if (p.fmt === "tam-hoa") mask |= B["Tam hoa"];
  else if (p.fmt === "sanh-tien") mask |= B["Sảnh tiến"];
  else if (p.fmt === "loc-phat") mask |= B["Lộc phát"];
  else if (p.fmt === "than-tai") mask |= B["Thần tài"];
  else if (p.fmt === "ong-dia") mask |= B["Ông địa"];

  let avoidList = [];
  if (p.avoids) {
    for (let i = 0; i < p.avoids.length; i++) {
      if (p.avoids[i] >= '0' && p.avoids[i] <= '9') avoidList.push(p.avoids[i].charCodeAt(0) - 48);
    }
  }

  const results = [];
  for (let i = 0; i < storage.plates.length; i++) {
    const item = storage.plates[i];
    if (p.type >= 0 && item.moto !== p.type) continue;
    if (mask && !(item.tag & mask)) continue;

    const prefix = storage.prefixes[item.pIdx];
    const prov = provOf(prefix.slice(0, 2));
    if (p.prov && prov !== p.prov) continue;
    if (p.nut > 0 && item.nut !== p.nut) continue;
    if (p.menh && !menhOk(item.num, p.menh)) continue;

    const numStr = pad5(item.num);
    if (avoidList.length > 0) {
      let hasAvoid = false;
      for (const d of avoidList) {
        if (numStr.includes(String(d))) { hasAvoid = true; break; }
      }
      if (hasAvoid) continue;
    }

    if (p.q) {
      if (p.q.includes('-')) {
        const parts = p.q.split('-');
        if (!prefix.includes(parts[0]) || !numStr.endsWith(parts[1])) continue;
      } else if (!numStr.endsWith(p.q) && !prefix.includes(p.q) && !numStr.includes(p.q)) {
        continue;
      }
    }

    const key = prefix + numStr;
    if (state.excludedKeys.has(key)) continue;

    results.push({ prefix, num: item.num, moto: item.moto, tag: item.tag, prov });
    state.excludedKeys.add(key);
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
        text: `❌ <b>Không tìm thấy biển nào</b> phù hợp với yêu cầu: <i>${p.raw}</i>.\n\n💡 <i>Mẹo: Gõ cú pháp ngắn như: <code>30K đuôi 68</code>, <code>Hà Nội lộc phát</code>, <code>tứ quý</code></i>`,
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
              text: `👋 Chào mừng bạn đến với <b>Bot Lọc Biển Số Phong Thủy</b> (khobienphongthuy.vn).\n\n⚡ <b>Tốc độ lọc:</b> Dưới 1 giây.\n🎯 <b>Mỗi lần lọc:</b> 15 - 20 biển đẹp kèm giá tham khảo.\n🔄 <b>Lọc thêm:</b> Bấm nút xem tiếp các biển khác hoàn toàn không trùng lặp!\n\n💡 <i>Ví dụ:</i>\n• <code>30K đuôi 68</code>\n• <code>Hà Nội đuôi 68 tránh 4 7</code>\n• <code>đuôi tam hoa 9 hà nội</code>\n• <code>tứ quý ô tô</code>`,
              parse_mode: 'HTML'
            });
            continue;
          }

          const filter = parseFilter(msgText);
          executeFilter(chatId, filter, false);
        }

        if (update.callback_query && update.callback_query.data === 'more') {
          const cb = update.callback_query;
          sendTelegram('answerCallbackQuery', { callback_query_id: cb.id, text: 'Đang lọc thêm 15-20 biển mới...' });
          if (cb.message && cb.message.chat) {
            const chatId = cb.message.chat.id;
            const state = userStates.get(chatId);
            if (state && state.lastP) {
              executeFilter(chatId, state.lastP, true);
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
  // Tự động tải lại kho biển mới mỗi 6 tiếng để luôn cập nhật theo web
  setInterval(loadData, 6 * 3600 * 1000);
  pollUpdates();
})();

