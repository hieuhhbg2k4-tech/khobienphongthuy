/* Nút "Tư vấn" / "Ý nghĩa" trên thẻ biển + hộp giải nghĩa biển số (dùng chung trang chủ và trang phong thủy).
   Thẻ biển chỉ cần nút: <button data-yn data-plate="30M-625.68" data-n="62568" data-tags="Lộc phát" data-nut="7" data-price="139 tr" data-msg="...">Ý nghĩa</button> */
(function () {
  const HOT = "0888188888", HOT_TXT = "0888.188.888", ZALO = "https://zalo.me/0888188888";
  // Ngũ hành chữ số (giống trang /phong-thuy/)
  const SO = { Kim:[6,7], Thủy:[0,1], Mộc:[3,4], Hỏa:[9], Thổ:[2,5,8] };
  const SINH = { Kim:"Thủy", Thủy:"Mộc", Mộc:"Hỏa", Hỏa:"Thổ", Thổ:"Kim" }, KHAC = { Kim:"Mộc", Mộc:"Thổ", Thổ:"Thủy", Thủy:"Hỏa", Hỏa:"Kim" };
  const hanhCua = d => Object.keys(SO).find(k => SO[k].includes(d));
  const me = m => Object.keys(SINH).find(k => SINH[k] === m), bi = m => Object.keys(KHAC).find(k => KHAC[k] === m);
  const hopMenh = n => Object.keys(SO).filter(m => {
    const g = new Set([...SO[m], ...SO[me(m)]]), k = new Set([...SO[bi(m)], ...SO[KHAC[m]]]), d = [...n].map(Number);
    return g.has(d[4]) && !d.some(x => k.has(x)) && d.filter(x => g.has(x)).length >= 3; });
  // Ý nghĩa theo quan niệm dân gian
  const SO1 = ["0 – tròn đầy, khởi đầu mới","1 – độc tôn, đứng đầu","2 – mãi mãi, cặp đôi","3 – tài, vững chắc","4 – tứ phương (có người kiêng)",
    "5 – ngũ phúc, sinh sôi","6 – lộc","7 – thất, quyền lực","8 – phát","9 – trường cửu, viên mãn"];
  const CAP = { "68":"Lộc phát","86":"Phát lộc","39":"Thần tài nhỏ","79":"Thần tài lớn","38":"Ông địa nhỏ","78":"Ông địa lớn","99":"Trường cửu",
    "88":"Phát phát","66":"Lộc lộc","83":"Phát tài","89":"Phát mãi","69":"Lộc cửu – lộc dài lâu","56":"Sinh lộc","58":"Sinh phát","26":"Mãi lộc","28":"Mãi phát",
    "16":"Nhất lộc","18":"Nhất phát","36":"Tài lộc","13":"Có người kiêng","49":"Có người kiêng","53":"Có người kiêng" };
  const NUT = n => n >= 9 ? "nút cao nhất, được nhiều người ưa chuộng" : n === 8 ? "nút phát" : n === 7 ? "nút khá" : n <= 3 ? "nút thấp" : "nút trung bình";

  const css = `.yn-ov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:90;display:flex;align-items:center;justify-content:center;padding:16px}
.yn-box{background:#fff;border-radius:12px;max-width:440px;width:100%;max-height:90vh;overflow:auto;padding:18px 18px 14px;position:relative;font:14px/1.55 Poppins,system-ui,sans-serif;color:#212529}
.yn-x{position:absolute;top:8px;right:10px;border:0;background:none;font-size:26px;line-height:1;cursor:pointer;color:#666}
.yn-pl{border:3px solid #111;border-radius:8px;box-shadow:inset 0 0 0 2px #fff,inset 0 0 0 4px #111;font:700 40px/1.1 "Barlow Condensed",sans-serif;text-align:center;padding:6px;margin:4px 30px 10px}
.yn-pr{text-align:center;color:#c1121f;font-weight:700;font-size:18px;margin-bottom:8px}
.yn-box dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 8px}.yn-box dt{color:#6c757d}.yn-box dd{margin:0;font-weight:500}
.yn-box ul{margin:4px 0 8px;padding-left:18px}.yn-box li{margin:2px 0}
.yn-note{font-size:12px;color:#888}
.yn-act{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
.yn-act a{display:flex;align-items:center;justify-content:center;padding:9px;border-radius:6px;font-weight:600;text-decoration:none}
.btn-tv{background:#fff!important;color:#222!important;border:1px solid #333!important}
.btn-tv:hover{background:#f1f1f1!important}
.btn-yn{background:#6f6f6f!important;color:#fff!important;border:1px solid #444!important}
.btn-yn:hover{background:#5a5a5a!important}`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));

  function open(b) {
    const n = b.dataset.n, d = [...n].map(Number), plate = b.dataset.plate, nut = +b.dataset.nut;
    const caps = []; for (let i = 0; i < 4; i++) { const c = n.slice(i, i + 2); if (CAP[c] && !caps.some(x => x[0] === c)) caps.push([c, CAP[c]]); }
    const hm = hopMenh(n), last = d[4];
    const ov = document.createElement("div"); ov.className = "yn-ov";
    ov.innerHTML = `<div class="yn-box" role="dialog" aria-label="Ý nghĩa biển ${esc(plate)}"><button class="yn-x" aria-label="Đóng">×</button>
      <div class="yn-pl">${esc(plate)}</div>${b.dataset.price ? `<div class="yn-pr">${esc(b.dataset.price)}</div>` : ""}
      <dl><dt>Dạng số</dt><dd>${esc(b.dataset.tags || "Số đẹp")}</dd>
        <dt>Tổng nút</dt><dd>${nut} nút – ${NUT(nut)}</dd>
        <dt>Số cuối</dt><dd>${last} – hành ${hanhCua(last)}</dd>
        <dt>Hợp mệnh</dt><dd>${hm.length ? hm.join(", ") : "Trung tính (có số khắc với mọi mệnh)"}</dd></dl>
      <b>Ý nghĩa các con số</b>
      <ul>${caps.map(([c, t]) => `<li><b>${c}</b>: ${t}</li>`).join("")}${[...new Set(d)].map(x => `<li>${SO1[x]}</li>`).join("")}</ul>
      <div class="yn-note">Giải nghĩa theo quan niệm dân gian, mang tính tham khảo. <a href="/phong-thuy/" style="color:#0d6efd">Xem biển hợp tuổi →</a></div>
      <div class="yn-act"><a class="btn-tv" href="tel:${HOT}">Gọi ${HOT_TXT}</a><a class="btn-yn" href="${ZALO}" target="_blank" rel="noopener">Nhắn Zalo</a></div></div>`;
    const close = () => { ov.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = e => { if (e.key === "Escape") close(); };
    ov.addEventListener("click", e => { if (e.target === ov || e.target.closest(".yn-x")) close(); });
    ov.querySelector(".yn-act .btn-yn").addEventListener("click", () => { if (window.KE && b.dataset.msg) KE.copyText(b.dataset.msg); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(ov); ov.querySelector(".yn-x").focus();
  }
  document.addEventListener("click", e => { const b = e.target.closest("[data-yn]"); if (b) { e.preventDefault(); open(b); } });
  window.YN = { open, hopMenh };
})();
