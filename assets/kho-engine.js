/* Bộ máy lọc biển dùng chung cho trang chủ và /admin.
   Mỗi nguồn biển lưu dạng mảng số (typed array) để lọc nhanh hàng triệu biển ngay trên trình duyệt. */
(function (G) {
"use strict";
const FMT_ORDER = ["Ngũ quý","Tứ quý","Tứ quý đầu","Tứ quý đuôi","Sảnh tiến","Tam hoa","Lộc phát","Thần tài","Ông địa","Đuôi 99","Đuôi 89","Năm sinh","ABAB","ABBA","AABB","Đối xứng","Kép đuôi","Số đẹp"];
const FMT_RANK = [10,9,9,9,8,7,5,5,4,4,3,4,6,6,6,5,3,1];
const B = {}; FMT_ORDER.forEach((f, i) => B[f] = 1 << i);
const YELLOW = /^\d{2}[HE]$/;   // seri biển vàng ô tô (kinh doanh vận tải)

// Mã tỉnh → tỉnh/thành sau sáp nhập (34 đơn vị, 2025)
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

// Ngũ hành theo số cuối (Hà Đồ): 1-6 Thủy, 2-7 Hỏa, 3-8 Mộc, 4-9 Kim, 5-0 Thổ
const ELEM = ["Thổ","Thủy","Hỏa","Mộc","Kim","Thổ","Thủy","Hỏa","Mộc","Kim"];
const SINH = { Kim:"Thổ", Thủy:"Kim", Mộc:"Thủy", Hỏa:"Mộc", Thổ:"Hỏa" }; // hành sinh ra hành đó
const MENH = ["Kim","Mộc","Thủy","Hỏa","Thổ"];
const menhOk = (x, m) => { const e = ELEM[x % 10]; return e === m || e === SINH[m]; };

function classify(x) {
  const a=(x/10000|0), b=(x/1000|0)%10, c=(x/100|0)%10, d=(x/10|0)%10, e=x%10; let m=0;
  if (a===b&&b===c&&c===d&&d===e) m|=B["Ngũ quý"]; else if ((b===c&&c===d&&d===e)||(a===b&&b===c&&c===d)) m|=B["Tứ quý"];
  if (!m && ((b===a+1&&c===b+1&&d===c+1&&e===d+1)||(c===b+1&&d===c+1&&e===d+1))) m|=B["Sảnh tiến"];
  if (!(m&(B["Ngũ quý"]|B["Tứ quý"])) && ((c===d&&d===e)||(a===b&&b===c))) m|=B["Tam hoa"];
  const l2=d*10+e; if (l2===68||l2===86) m|=B["Lộc phát"]; if (l2===39||l2===79) m|=B["Thần tài"]; if (l2===38||l2===78) m|=B["Ông địa"];
  const y=x%10000; if ((b===1&&c===9&&y>=1950)||(b===2&&c===0&&y<=2030)) m|=B["Năm sinh"];
  if (b===d&&c===e&&b!==c) m|=B["ABAB"]; if (b===e&&c===d&&b!==c) m|=B["ABBA"]; if (b===c&&d===e&&b!==d) m|=B["AABB"];
  if (a===e&&b===d&&!(m&B["Ngũ quý"])) m|=B["Đối xứng"];
  if (!m && d===e) m|=B["Kép đuôi"]; if (!m) m|=B["Số đẹp"];
  // Tứ quý đầu (1111x) / Tứ quý đuôi (x1111), đuôi 99 / 89 — thêm sau để không ảnh hưởng nhóm chính
  if (m & B["Tứ quý"]) m |= (a===b&&b===c&&c===d) ? B["Tứ quý đầu"] : B["Tứ quý đuôi"];
  if (l2===99) m|=B["Đuôi 99"]; if (l2===89) m|=B["Đuôi 89"];
  return m;
}
const mainIdx = m => 31 - Math.clz32(m & -m);
const mainOf = m => FMT_ORDER[mainIdx(m)];
const tagsOf = m => FMT_ORDER.filter((f, i) => m & (1 << i));
const scoreOf = m => { let s = 0; for (let i = 0; i < FMT_ORDER.length; i++) if (m & (1 << i) && FMT_RANK[i] > s) s = FMT_RANK[i]; return s; };
const nutOf = x => ((x/10000|0)+((x/1000|0)%10)+((x/100|0)%10)+((x/10|0)%10)+x%10) % 10 || 10;
const pad5 = n => String(n).padStart(5, "0");

/* ===== Nguồn biển ===== */
// opts: {id, name, kind:'car'|'moto'|'mix', group:'vpa'|'kho', live:bool, cap}
function Source(opts) {
  const n = opts.cap || 1024;
  Object.assign(this, opts);
  this.pre = []; this.preIdx = {}; this.len = 0;
  this.pi = new Uint16Array(n); this.num = new Uint32Array(n); this.tag = new Uint32Array(n);
  this.nut = new Uint8Array(n); this.moto = new Uint8Array(n); this.dup = null;
  if (opts.live) { this.date = new Uint32Array(n); this.cnt = new Int32Array(n); }
  if (opts.group === "kho") { this.price = new Float64Array(n).fill(NaN); this.extra = []; }
}
Source.prototype.grow = function () {
  const n = this.num.length * 2, cp = (A, f) => { const b = new A.constructor(n); if (f !== undefined) b.fill(f); b.set(A); return b; };
  ["pi","num","tag","nut","moto","date","cnt"].forEach(k => { if (this[k]) this[k] = cp(this[k]); });
  if (this.price) this.price = cp(this.price, NaN);
};
// Thêm 1 biển: prefix "30K" / "29AA" / "29B1", x = 5 số cuối (số nguyên)
Source.prototype.add = function (prefix, x, moto, more) {
  if (!this.keepYellow && YELLOW.test(prefix)) return -1;
  let gi = this.preIdx[prefix];
  if (gi === undefined) { gi = this.preIdx[prefix] = this.pre.length; this.pre.push(prefix); }
  if (this.len >= this.num.length) this.grow();
  const k = this.len++;
  this.pi[k] = gi; this.num[k] = x; this.tag[k] = classify(x); this.nut[k] = nutOf(x); this.moto[k] = moto ? 1 : 0;
  if (more) {
    if (this.date && more.date) this.date[k] = more.date;
    if (this.cnt) this.cnt[k] = more.cnt == null ? -1 : more.cnt;
    if (this.price && more.price != null && more.price !== "") this.price[k] = +more.price;
    if (this.extra) this.extra[k] = more.extra || null;
  }
  return k;
};
Source.prototype.text = function (i) { const n = pad5(this.num[i]); return this.pre[this.pi[i]] + "-" + n.slice(0, 3) + "." + n.slice(3); };
Source.prototype.code = function (i) { return this.pre[this.pi[i]].slice(0, 2); };
Source.prototype.prov = function (i) { return provOf(this.code(i)); };

// File JSON /vpa-data/<id>.json: {kind, groups:{prefix:{p, n:"5 số liền nhau…"}}}
function fromExcel(meta, d) {
  const s = new Source({ id: meta.id, name: meta.name, kind: d.kind, group: "vpa", cap: (meta.count || 1000) + 16 });
  const moto = d.kind === "moto";
  for (const key in d.groups) {
    const str = d.groups[key].n;
    for (let j = 0; j + 5 <= str.length; j += 5) s.add(key, +str.substr(j, 5), moto);
  }
  return s;
}
// Dữ liệu Sheet BIENSOVP: {rows:[[biển, tỉnh, xe máy 0/1, "dd/MM/yyyy", số người ĐK]]}
function fromLive(d, meta) {
  const rows = d.rows || [];
  const s = new Source(Object.assign({ id: "live", name: "VPA cập nhật hằng ngày", kind: "mix", group: "vpa", live: true, cap: rows.length + 16 }, meta || {}));
  for (const r of rows) {
    const raw = String(r[0]).toUpperCase().replace(/[^0-9A-Z]/g, ""), m = raw.match(/^(\d{2}[A-Z][A-Z0-9]?)(\d{5})$/);
    if (!m) continue;
    const dm = String(r[3] || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    s.add(m[1], +m[2], r[2], { date: dm ? +(dm[3] + dm[2] + dm[1]) : 0, cnt: typeof r[4] === "number" ? r[4] : -1 });
  }
  s.updated = d.updated || "";
  return s;
}
// Kho của tôi: rows [{plate:"30K-123.45", price, moto, isNew, cost?, seller?, group?, row?}]
function fromKho(rows) {
  const s = new Source({ id: "kho", name: "Kho của tôi", kind: "mix", group: "kho", keepYellow: true, cap: rows.length + 16 });
  for (const r of rows) {
    const m = String(r.plate || "").toUpperCase().match(/^(\d{2})([A-Z]{1,2}\d?)-?(\d{3})\.?(\d{2})$/);
    if (!m) continue;
    s.add(m[1] + m[2], +(m[3] + m[4]), r.moto, { price: r.price, extra: r });
  }
  return s;
}

// Đánh dấu biển trùng giữa các nguồn (nguồn đứng trước được giữ) — dùng cho chế độ "Tất cả"
function markDups(list) {
  const seen = new Map();
  for (const s of list) {
    s.dup = new Uint8Array(s.len);
    for (let i = 0; i < s.len; i++) {
      const p = s.pre[s.pi[i]];
      let bits = seen.get(p); if (!bits) { bits = new Uint8Array(12500); seen.set(p, bits); }
      const x = s.num[i], b = 1 << (x & 7);
      if (bits[x >> 3] & b) s.dup[i] = 1; else bits[x >> 3] |= b;
    }
  }
}

/* ===== Lọc ===== */
// F: {q, fmt, avoid:[], nut, year:''|'all'|'1990', prov, head, letter, digits:[], type:''|'0'|'1', menh, price:'min-max', dated:''|'1'|'0'}
function filter(list, F, dedupe) {
  const q = (F.q || "").toUpperCase().replace(/[\s\-.]/g, "");
  let pat = null, re = null;
  if (/^[A-E]{2,5}$/.test(q)) pat = q; else if (q.includes("*")) { try {
    // "*68" = đuôi 68 (kết thúc bằng 68); "68*" = 5 số bắt đầu bằng 68; "39*39" = có 39 rồi 39
    const body = q.replace(/[^0-9A-Z*]/g, ""), src = body.replace(/\*/g, "\\d*");
    re = new RegExp((/^\*/.test(body) && !/\*$/.test(body) ? src + "$" : src)); } catch (e) {} }
  const fbit = F.fmt ? B[F.fmt] : 0, avs = F.avoid || [], digs = F.digits || [];
  const nuts = [].concat(F.nut || []).map(Number).filter(Boolean), nutOk = new Uint8Array(11); nuts.forEach(v => nutOk[v] = 1); const nut = nuts.length;
  const yr = F.year === "all" ? -1 : (+F.year || 0), type = F.type === "" || F.type == null ? -1 : +F.type;
  let pmin = -Infinity, pmax = Infinity;
  if (F.price) { const [a, b] = F.price.split("-"); pmin = a === "" ? -Infinity : +a; pmax = b === "" ? Infinity : +b; }
  const out = [];
  list.forEach((s, si) => {
    if (F.price && !s.price) return;
    if (F.dated && !s.date) { if (F.dated === "1") return; }
    const preOk = s.pre.map(p => (!F.prov || provOf(p.slice(0, 2)) === F.prov) && (!F.head || p.startsWith(F.head)) && (!F.letter || p[2] === F.letter));
    const dup = dedupe ? s.dup : null, base = si * 16777216;
    for (let i = 0; i < s.len; i++) {
      if (!preOk[s.pi[i]] || (dup && dup[i])) continue;
      if (fbit && !(s.tag[i] & fbit)) continue;
      if (nut && !nutOk[s.nut[i]]) continue;
      if (type >= 0 && s.moto[i] !== type) continue;
      const x = s.num[i];
      if (yr) { if (yr < 0 ? !(s.tag[i] & B["Năm sinh"]) : x % 10000 !== yr) continue; }
      if (F.menh && !menhOk(x, F.menh)) continue;
      if (F.price) { const v = s.price[i]; if (!(v >= pmin && v < pmax)) continue; }
      if (F.dated && s.date) { if (F.dated === "1" ? !s.date[i] : s.date[i]) continue; }
      if (avs.length || digs.length || q) {
        const n = pad5(x);
        if (avs.length && avs.some(a => n.includes(a))) continue;
        if (digs.length && !digs.every(d => n.includes(d))) continue;
        if (q) {
          if (pat) { const t = n.slice(-pat.length), mp = {}, us = {}; let ok = true;
            for (let j = 0; j < pat.length; j++) { const L = pat[j], c = t[j]; if (mp[L] === undefined) { if (us[c]) { ok = false; break; } mp[L] = c; us[c] = 1; } else if (mp[L] !== c) { ok = false; break; } }
            if (!ok) continue; }
          else { const full = s.pre[s.pi[i]] + n; if (re ? !re.test(full) : !full.includes(q)) continue; }
        }
      }
      out.push(base + i);
    }
  });
  return out;
}
const unpack = (list, v) => [list[Math.floor(v / 16777216)], v % 16777216];

// Sắp xếp: hot (dạng số đẹp trước), date (lịch đấu giá gần nhất), reg (nhiều người ĐK), price (giá cao → thấp), plate
function sortRes(list, res, how) {
  if (how === "hot") {
    const buckets = Array.from({ length: 11 }, () => []);
    for (const v of res) { const [s, i] = unpack(list, v); buckets[scoreOf(s.tag[i])].push(v); }
    let k = 0; for (let b = 10; b >= 0; b--) for (const v of buckets[b]) res[k++] = v;
    return res;
  }
  const key = how === "date" ? (s, i) => (s.date && s.date[i]) ? s.date[i] : 9e9
            : how === "reg" ? (s, i) => -(s.cnt ? s.cnt[i] : -1)
            : how === "price" ? (s, i) => { const p = s.price ? s.price[i] : NaN; return isNaN(p) ? 9e15 : -p; }
            : how === "priceAsc" ? (s, i) => { const p = s.price ? s.price[i] : NaN; return isNaN(p) ? 9e15 : p; }
            : null;
  if (!key) return res;
  const has = [], rest = [];
  for (const v of res) { const [s, i] = unpack(list, v); const k = key(s, i); (k >= 9e9 ? rest : has).push([k, v]); }
  has.sort((a, b) => a[0] - b[0]);
  let k = 0; for (const [, v] of has) res[k++] = v; for (const [, v] of rest) res[k++] = v;
  return res;
}

// Đầu biển & chữ theo tỉnh / đầu đang chọn
function heads(list, prov) { const h = new Set(); list.forEach(s => s.pre.forEach(p => { if (!prov || provOf(p.slice(0, 2)) === prov) h.add(p.slice(0, 2)); })); return [...h].sort(); }
function letters(list, prov, head) { const l = new Set(); list.forEach(s => s.pre.forEach(p => { if ((!prov || provOf(p.slice(0, 2)) === prov) && (!head || p.startsWith(head)) && /[A-Z]/.test(p[2])) l.add(p[2]); })); return [...l].sort(); }
function provs(list) { const v = new Set(); list.forEach(s => s.pre.forEach(p => v.add(provOf(p.slice(0, 2))))); return [...v].sort((a, b) => a.localeCompare(b, "vi")); }
// Giá tham khảo (ô tô + xe máy) theo lịch sử trúng đấu giá VPA cùng 5 số cuối — dữ liệu /assets/gia.json
const KEP_MIN = 100;   // giá tối thiểu (tr) cho tam hoa kép có số ngoài 0,1,2,4
let GIA = null; const HN_CODES = new Set(["29","30","31","32","33","40"]);
const TAM_HOA_DAU_MIN = { "1": 79, "4": 79, "7": 89, "2": 99, "3": 99, "5": 99, "6": 109, "8": 119, "9": 119, "0": 79 };
const LAN_CAN = new Set(["Bắc Ninh","Hưng Yên","Phú Thọ","Thái Nguyên","Ninh Bình","Hải Phòng"]);   // tỉnh lân cận Hà Nội
let GROUP_KB = new Map();
const setGia = g => {
  GIA = g && g.t ? g : null; GROUP_KB = new Map();
  if (!GIA || !GIA.k) return;
  for (const [plate, value] of Object.entries(GIA.k)) {
    const match = plate.match(/^(\d{2}[A-Z][A-Z0-9]?)(\d{5})$/);
    if (!match || !Number.isFinite(value)) continue;
    // Dữ liệu giá hiện có: seri 1 chữ cho ô tô, 2 ký tự cho xe máy.
    const moto = GIA.kt && plate in GIA.kt ? +GIA.kt[plate] : +(match[1].length > 3);
    const group = moto + "|" + provOf(match[1].slice(0, 2)) + "|" + match[2];
    const old = GROUP_KB.get(group);
    GROUP_KB.set(group, old === -1 || value === -1 ? -1 : old == null ? value : Math.max(old, value));
  }
};
// Giá bán = giá theo lịch sử trúng đấu giá VPA (cùng 5 số cuối), nhưng KHÔNG thấp hơn giá khobienvietnam + 10%.
// Từ 1 tỷ -> "Liên hệ" (-1). Số đẹp (sảnh, tứ quý, ngũ quý) không có dữ liệu -> "Liên hệ".
const KB_MARKUP = 1.10, CONTACT_FROM = 1000;
function giaRaw(s, i) {
  if (!GIA) return null;
  const n = pad5(s.num[i]), key = s.pre[s.pi[i]] + n, moto = s.moto[i];
  const tbl = moto ? GIA.m : GIA; if (!tbl) return null;
  const floor = tbl.min;
  const hv = tbl.t && tbl.t[n] ? tbl.t[n][HN_CODES.has(s.pre[s.pi[i]].slice(0, 2)) ? 0 : 1] : null;   // lịch sử VPA
  const grouped = GROUP_KB.get(moto + "|" + provOf(s.pre[s.pi[i]].slice(0, 2)) + "|" + n);
  const kb = grouped != null ? grouped : GIA.k && key in GIA.k ? GIA.k[key] : null;                                              // khobienvietnam
  // Dòng tiến đuôi 68 biển Hà Nội (5 số không giảm, không có 4/7, không tam hoa): đầu 0 = 130 tr, còn lại 150 tr (chủ web đặt 22/10/2026)
  if (!moto && HN_CODES.has(s.pre[s.pi[i]].slice(0, 2)) && /68$/.test(n) && !/[47]/.test(n) && !/(\d)\1\1/.test(n)
      && n[0] <= n[1] && n[1] <= n[2] && n[2] <= n[3]) return n[0] === "0" ? 130 : 150;
  // Tứ quý đuôi X.AAAA biển Hà Nội: giá chủ web đặt
  if (!moto && GIA.tqd_hn && HN_CODES.has(s.pre[s.pi[i]].slice(0, 2)) && /^(\d)(\d)\2\2\2$/.test(n) && n[0] !== n[1] && GIA.tqd_hn[n[1]] != null) return GIA.tqd_hn[n[1]];
  if (kb === -1 || hv === -1) return -1;
  let v;
  // Tam hoa kép AA.BBB: bảng giá riêng theo vùng [Hà Nội, tỉnh lân cận, tỉnh xa] (chủ web đặt, ưu tiên hơn mọi quy tắc khác)
  const kep = !moto && GIA.kep && GIA.kep[n];
  if (kep) {
    const c = s.pre[s.pi[i]].slice(0, 2), z = HN_CODES.has(c) ? 0 : LAN_CAN.has(provOf(c)) ? 1 : 2;
    return kep[z] >= CONTACT_FROM ? -1 : kep[z];
  }
  // Tam hoa đầu AAA.XY (không tính tứ quý đầu, ngũ quý): bảng theo vùng từ giá trúng VPA, còn lại giá sàn theo đầu số
  if (!moto && /^(\d)\1\1/.test(n) && n[3] !== n[0]) {
    const c = s.pre[s.pi[i]].slice(0, 2), z = HN_CODES.has(c) ? 0 : LAN_CAN.has(provOf(c)) ? 1 : 2;
    const th = GIA.th && GIA.th[n];
    v = Math.max(th ? th[z] : 0, TAM_HOA_DAU_MIN[n[0]] || floor);
    return v >= CONTACT_FROM ? -1 : v;
  }
  if (kb != null) v = Math.max(hv || floor, Math.round(kb * KB_MARKUP));
  else {
    if (!moto && scoreOf(s.tag[i]) >= 8) return -1;          // chưa có giá khobienvietnam để so -> Liên hệ
    v = hv != null ? Math.max(floor, hv) : floor;
    if (!moto && /^(\d)\1(\d)\2\2$|^(\d)\3\3(\d)\4$/.test(n) && n[0] !== n[4] && /[35-9]/.test(n)) v = Math.max(KEP_MIN, v);   // tam hoa kép
  }
  if (v >= CONTACT_FROM) return -1;
  // Bảng tam hoa ô tô (giá sàn); tứ quý/ngũ quý và các nhóm 666/888/999 giữ nguyên.
  // Chỉ áp cho biển chưa có giá khobienvietnam; có giá kbvn thì luôn giữ tối thiểu kbvn +10%.
  if (kb == null && !moto && (s.tag[i] & B["Tam hoa"]) && !(s.tag[i] & (B["Tứ quý"] | B["Ngũ quý"]))) {
    const tail = n.match(/(\d)\1\1$/), head = n.match(/^(\d)\1\1/);
    const digit = (tail || head || [])[1];
    if (digit === "1" || digit === "4") v = 79;
    else if (digit === "2") v = 99;
    else if (digit === "3" || digit === "5" || digit === "7") {
      const reference = grouped != null && grouped >= 0 ? Math.max(hv || floor, Math.round(grouped * KB_MARKUP)) : v;
      v = digit === "7" ? (reference >= 109 ? 109 : reference >= 99 ? 99 : 89) : (reference >= 119 ? 119 : reference >= 109 ? 109 : 99);
    }
    if (hv != null && hv > v) v = hv;   // không bán thấp hơn giá lịch sử trúng đấu giá VPA của đuôi 5 số
  }
  return v;
}
const giaText = v => v == null ? "" : v < 0 ? "Liên hệ" : v >= 1000 ? (v / 1000).toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + " tỷ" : v + " tr";
const fmtDate = n => n ? String(n).replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1") : "";

async function copyText(t) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); return true; } } catch (e) {}
  const ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(ta); ta.focus(); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); return ok;
}
function downloadCsv(name, head, rows) {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob(["\ufeff" + [head.map(q).join(",")].concat(rows.map(r => r.map(q).join(","))).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Giá lẻ đuôi 1,2,3,4,6,7,8 -> đuôi 9 (173 -> 179); giữ đuôi 0, 5, 9
function giaOf(s, i) { const v = giaRaw(s, i); if (v == null || v <= 0) return v; const d = v % 10; return d === 0 || d === 5 || d === 9 ? v : v - d + 9; }

G.KE = { FMT_ORDER, B, MENH, ELEM, NEWPROV, provOf, classify, mainOf, tagsOf, scoreOf, nutOf, pad5, Source, fromExcel, fromLive, fromKho,
  markDups, filter, unpack, sortRes, heads, letters, provs, fmtDate, copyText, downloadCsv, setGia, giaOf, giaText };
})(window);
