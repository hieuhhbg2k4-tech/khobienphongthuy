/* Trợ lý AI trên web: khung chat + công cụ tra kho chạy tại trình duyệt (dùng dữ liệu kho, giá và quy tắc của chính trang).
   Bật bằng cách đặt TRO_LY_URL = địa chỉ Cloudflare Worker (xem worker/HUONG-DAN.md). Để trống = ẩn khung chat. */
(function () {
  const TRO_LY_URL = "https://script.google.com/macros/s/AKfycbwePjxnQyAfGaHaT6bnnWAgx6H_2QzQ8OEUZ5k8vEphCmzJrHUGhH-YyRboXBDvJUaQzw/exec";   // ví dụ "https://tro-ly.<tên>.workers.dev"
  const URL_ = window.TRO_LY_URL || TRO_LY_URL;
  if (!URL_ && !/[?&]troly=test/.test(location.search)) return;
  const HOT = "0888188888", ZALO = "https://zalo.me/0888188888";
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

  /* ===== Phong thủy (cùng quy tắc trang /phong-thuy/) ===== */
  const CAN = ["Giáp","Ất","Bính","Đinh","Mậu","Kỷ","Canh","Tân","Nhâm","Quý"], CHI = ["Tý","Sửu","Dần","Mão","Thìn","Tỵ","Ngọ","Mùi","Thân","Dậu","Tuất","Hợi"];
  const NAPAM = ["Hải Trung Kim","Lư Trung Hỏa","Đại Lâm Mộc","Lộ Bàng Thổ","Kiếm Phong Kim","Sơn Đầu Hỏa","Giản Hạ Thủy","Thành Đầu Thổ","Bạch Lạp Kim","Dương Liễu Mộc",
    "Tuyền Trung Thủy","Ốc Thượng Thổ","Tích Lịch Hỏa","Tùng Bách Mộc","Trường Lưu Thủy","Sa Trung Kim","Sơn Hạ Hỏa","Bình Địa Mộc","Bích Thượng Thổ","Kim Bạch Kim",
    "Phú Đăng Hỏa","Thiên Hà Thủy","Đại Trạch Thổ","Thoa Xuyến Kim","Tang Đố Mộc","Đại Khê Thủy","Sa Trung Thổ","Thiên Thượng Hỏa","Thạch Lựu Mộc","Đại Hải Thủy"];
  const SO = { Kim:[6,7], Thủy:[0,1], Mộc:[3,4], Hỏa:[9], Thổ:[2,5,8] };
  const SINH = { Kim:"Thủy", Thủy:"Mộc", Mộc:"Hỏa", Hỏa:"Thổ", Thổ:"Kim" }, KHAC = { Kim:"Mộc", Mộc:"Thổ", Thổ:"Thủy", Thủy:"Hỏa", Hỏa:"Kim" };
  const me = m => Object.keys(SINH).find(k => SINH[k] === m), bi = m => Object.keys(KHAC).find(k => KHAC[k] === m);
  const sinh = m => [...SO[m], ...SO[me(m)]].sort(), hop = m => [...SO[SINH[m]]], khac = m => [...SO[bi(m)], ...SO[KHAC[m]]].sort();
  function tuoi(y) { const i = ((y - 4) % 60 + 60) % 60, na = NAPAM[i >> 1], m = na.split(" ").pop();
    return { nam: y, can_chi: CAN[((y - 4) % 10 + 10) % 10] + " " + CHI[((y - 4) % 12 + 12) % 12], nap_am: na, menh: m,
      so_tuong_sinh: sinh(m), so_tuong_hop: hop(m), so_tuong_khac: khac(m), trang_xem_them: `https://khobienphongthuy.vn/phong-thuy/${y}/` }; }
  const hopMenh = n => { const d = [...n].map(Number);
    return Object.keys(SO).filter(m => { const g = new Set(sinh(m)), k = new Set(khac(m)); return g.has(d[4]) && !d.some(x => k.has(x)) && d.filter(x => g.has(x)).length >= 3; }); };

  /* ===== Dữ liệu kho: dùng biến SRC của trang ===== */
  const getSrc = () => { try { return typeof SRC !== "undefined" && SRC.length ? SRC : null; } catch (e) { return null; } };
  async function waitSrc() { for (let i = 0; i < 60; i++) { const s = getSrc(); if (s) return s; await new Promise(r => setTimeout(r, 250)); } return null; }
  const vnH = () => { const d = new Date(Date.now() + 7 * 3600e3); return d.getUTCHours() + d.getUTCMinutes() / 60; };
  function giaWeb(s, i) {
    const g = KE.giaOf(s, i); if (g == null || g < 0) return { gia: "Liên hệ", trieu: g < 0 ? 1e9 : null };
    let sale = null;
    try { if (typeof SALE !== "undefined" && SALE.on && vnH() >= SALE.from && vnH() < SALE.to) sale = (SALE.fixed && SALE.fixed[g] != null) ? SALE.fixed[g] : Math.round(g * (100 - SALE.pct) / 100); } catch (e) {}
    return { gia: KE.giaText(g), trieu: g, gia_gio_vang: sale != null ? KE.giaText(sale) : undefined };
  }
  function info(s, i) { const n = KE.pad5(s.num[i]), g = giaWeb(s, i), date = s.date ? s.date[i] : 0;
    return { bien: s.text(i), tinh: s.prov(i), loai: s.moto[i] ? "Xe máy" : "Ô tô", ...g, dang: KE.tagsOf(s.tag[i]).join(", ") || "Số đẹp",
      nut: s.nut[i], hop_menh: hopMenh(n), ngay_dau_gia: date ? KE.fmtDate(date) : undefined }; }

  const TOOLS = {
    async tim_bien(a) {
      const src = await waitSrc(); if (!src) return { loi: "Kho đang tải, mời khách thử lại sau ít giây." };
      const type = a.loai_xe === "oto" ? "0" : a.loai_xe === "xemay" ? "1" : "";
      const so = (a.so || "").trim();
      let res = KE.filter(src, { q: so, fmt: a.dang_so || "", avoid: a.tranh_so || [], prov: a.tinh || "", type, menh: "" }, true);
      if (a.menh && SO[a.menh]) { const G = new Set(sinh(a.menh)), K = new Set(khac(a.menh));
        res = res.filter(v => { const [s, i] = KE.unpack(src, v), d = [...KE.pad5(s.num[i])].map(Number); return G.has(d[4]) && !d.some(x => K.has(x)) && d.filter(x => G.has(x)).length >= 3; }); }
      const lo = a.gia_tu || 0, hi = a.gia_den || Infinity;
      if (a.gia_tu || a.gia_den) res = res.filter(v => { const [s, i] = KE.unpack(src, v), g = KE.giaOf(s, i); const t = g == null ? null : g < 0 ? 1e9 : g; return t != null && t >= lo && t <= hi; });
      const total = res.length; KE.sortRes(src, res, "hot");
      const n = Math.min(10, Math.max(8, a.so_luong || 10));   // luôn 8–10 biển
      return { tong_so_bien_phu_hop: total, bien: res.slice(0, n).map(v => { const [s, i] = KE.unpack(src, v); return info(s, i); }),
        ghi_chu: total ? "Giá là giá bán trên web hiện tại. Liệt kê đủ tất cả các biển trong danh sách này cho khách." : "Không có biển phù hợp. Chỉ nới điều kiện thêm tối đa 1 lần rồi trả lời khách ngay; có thể giải thích lý do (vd số khắc mệnh) và mời gọi 0888.188.888." };
    },
    async phong_thuy_tuoi(a) { const y = +a.nam_sinh; if (!(y >= 1900 && y <= 2100)) return { loi: "Năm sinh không hợp lệ" }; return tuoi(y); },
    async y_nghia_bien(a) {
      const src = await waitSrc(); const raw = String(a.bien || "").toUpperCase().replace(/[^0-9A-Z]/g, ""), m = raw.match(/^(\d{2}[A-Z][A-Z0-9]?)(\d{5})$/);
      if (!m) return { loi: "Biển không đúng định dạng, ví dụ 30K-668.68" };
      const n = m[2];
      if (src) for (const s of src) { const pi = s.pre.indexOf(m[1]); if (pi < 0) continue;
        for (let i = 0; i < s.len; i++) if (s.pi[i] === pi && KE.pad5(s.num[i]) === n && !(s.dup && s.dup[i])) return { co_trong_kho: true, ...info(s, i) }; }
      return { co_trong_kho: false, bien: m[1] + "-" + n.slice(0, 3) + "." + n.slice(3), dang: KE.tagsOf(KE.classify(+n)).join(", "), hop_menh: hopMenh(n),
        ghi_chu: "Biển không có trong kho web; mời khách gọi 0888.188.888 để kiểm tra." };
    }
  };

  /* ===== Giao diện khung chat ===== */
  const css = `.tl-btn{position:fixed;right:16px;bottom:16px;z-index:70;width:58px;height:58px;border-radius:50%;border:0;background:linear-gradient(135deg,#0d6efd,#c1121f);color:#fff;font:700 13px Poppins,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35);cursor:pointer}
.tl-btn span{display:block;font-size:22px;line-height:1}
.tl-box{position:fixed;right:16px;bottom:84px;z-index:71;width:min(380px,calc(100vw - 32px));height:min(560px,calc(100vh - 110px));background:#fff;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;font:14px/1.5 Poppins,system-ui,sans-serif;color:#212529}
.tl-head{background:#0d6efd;color:#fff;padding:10px 14px;display:flex;align-items:center;gap:10px}
.tl-head b{flex:1}.tl-head small{display:block;font-weight:400;opacity:.85;font-size:11px}
.tl-head button{background:none;border:0;color:#fff;font-size:22px;cursor:pointer}
.tl-log{flex:1;overflow:auto;padding:12px;background:#f6f7f9;display:flex;flex-direction:column;gap:8px}
.tl-m{max-width:86%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}
.tl-m.u{align-self:flex-end;background:#0d6efd;color:#fff;border-bottom-right-radius:4px}
.tl-m.a{align-self:flex-start;background:#fff;border:1px solid #e3e5e8;border-bottom-left-radius:4px}
.tl-m.t{align-self:center;background:none;color:#888;font-size:12px;padding:2px}
.tl-sug{display:flex;gap:6px;flex-wrap:wrap;padding:0 12px 8px;background:#f6f7f9}
.tl-sug button{border:1px solid #cdd3da;background:#fff;border-radius:999px;padding:4px 10px;font-size:12px;cursor:pointer}
.tl-in{display:flex;gap:6px;padding:8px;border-top:1px solid #e3e5e8}
.tl-in input{flex:1;border:1px solid #ced4da;border-radius:8px;padding:8px 10px;font:inherit;outline:0}
.tl-in button{border:0;background:#c1121f;color:#fff;border-radius:8px;padding:0 14px;font-weight:600;cursor:pointer}
.tl-foot{font-size:11px;color:#888;text-align:center;padding:0 8px 6px}
@media (max-width:600px){.tl-btn{bottom:12px;right:12px}.tl-box{right:8px;left:8px;width:auto;bottom:78px;height:calc(100vh - 100px)}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const btn = document.createElement("button"); btn.className = "tl-btn"; btn.setAttribute("aria-label", "Mở trợ lý AI"); btn.innerHTML = "<span>💬</span>AI";
  const box = document.createElement("div"); box.className = "tl-box"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Trợ lý AI");
  box.innerHTML = `<div class="tl-head"><b>Trợ lý Kho Biển Phong Thủy<small>Tìm biển · Phong thủy · Báo giá theo kho</small></b><button aria-label="Đóng">×</button></div>
    <div class="tl-log" aria-live="polite"></div>
    <div class="tl-sug"><button>Tìm biển ô tô Hà Nội dưới 100 triệu</button><button>Tôi sinh 1990, biển nào hợp?</button><button>Biển ngũ quý giá bao nhiêu?</button></div>
    <form class="tl-in"><input placeholder="Nhập câu hỏi… (vd: tìm đuôi 6868)" aria-label="Câu hỏi" maxlength="500"><button>Gửi</button></form>
    <div class="tl-foot">Trợ lý AI có thể nhầm — xác nhận với hotline <a href="tel:${HOT}">0888.188.888</a> trước khi đặt cọc.</div>`;
  document.body.append(btn, box);
  const log = box.querySelector(".tl-log"), form = box.querySelector("form"), input = form.querySelector("input");
  // Hiển thị chữ an toàn + **đậm** và gạch đầu dòng "* " của AI
  const fmt = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^\s*[*-]\s+/gm, "• ").replace(/^#{1,6}\s*(.+)$/gm, "<b>$1</b>").replace(/(\d{2}[A-Z]{1,2}\d?-\d{3}\.\d{2})/g, '<a href="/?q=$1#kho" style="color:#c1121f;font-weight:600">$1</a>');
  const add = (cls, text) => { const d = document.createElement("div"); d.className = "tl-m " + cls; if (cls === "a") d.innerHTML = fmt(text); else d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  let history = [], busy = false, greeted = false;
  try { history = JSON.parse(sessionStorage.getItem("tl-h") || "[]"); } catch (e) {}
  const save = () => { try { sessionStorage.setItem("tl-h", JSON.stringify(history.slice(-30))); } catch (e) {} };
  function redrawHistory() { for (const m of history) { if (typeof m.content === "string") add(m.role === "user" ? "u" : "a", m.content);
    else if (m.role === "assistant") { const t = m.content.filter(c => c.type === "text").map(c => c.text).join("\n").trim(); if (t) add("a", t); } } }
  btn.addEventListener("click", () => { box.hidden = !box.hidden;
    if (!box.hidden && !greeted) { greeted = true; if (history.length) redrawHistory(); else add("a", "Em chào anh/chị! Em là trợ lý AI của Kho Biển Phong Thủy. Anh/chị cần tìm biển theo số, theo tầm giá, hay xem biển hợp tuổi ạ?"); }
    if (!box.hidden) input.focus(); });
  box.querySelector(".tl-head button").addEventListener("click", () => box.hidden = true);
  box.querySelector(".tl-sug").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { input.value = b.textContent; form.requestSubmit(); } });

  async function callAI() {
    const r = await fetch(URL_, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ messages: history }) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json(); if (j.error) throw new Error(typeof j.error === "string" ? j.error : JSON.stringify(j.error)); return j;
  }
  form.addEventListener("submit", async e => {
    e.preventDefault(); const q = input.value.trim(); if (!q || busy) return;
    busy = true; input.value = ""; add("u", q); history.push({ role: "user", content: q });
    box.querySelector(".tl-sug").hidden = true;
    const wait = add("t", "Trợ lý đang trả lời…");
    try {
      for (let round = 0; round < 4; round++) {
        const res = await callAI();
        const content = res.content || []; history.push({ role: "assistant", content });
        const text = content.filter(c => c.type === "text").map(c => c.text).join("\n").trim();
        if (text) add("a", text);
        const uses = content.filter(c => c.type === "tool_use"); if (!uses.length) break;
        wait.textContent = "Đang tra kho biển…";
        const results = [];
        for (const u of uses) { let out; try { out = TOOLS[u.name] ? await TOOLS[u.name](u.input || {}) : { loi: "Không có công cụ này" }; } catch (err) { out = { loi: String(err) }; }
          results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out) }); }
        history.push({ role: "user", content: results });
      }
    } catch (err) {
      add("a", /429|quota|RESOURCE_EXHAUSTED/i.test(String(err)) ? "Dạ trợ lý AI đã hết lượt trả lời miễn phí hôm nay. Anh/chị gọi hoặc nhắn Zalo 0888.188.888, nhân viên tư vấn ngay ạ."
        : "Xin lỗi, trợ lý đang bận. Anh/chị thử lại sau ít phút, hoặc gọi/nhắn Zalo 0888.188.888 để được tư vấn ngay ạ.");
      history = history.filter(m => typeof m.content === "string");
    } finally { wait.remove(); busy = false; save(); }
  });
  window.TroLy = { TOOLS, tuoi };
})();
