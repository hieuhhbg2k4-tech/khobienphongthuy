// Sinh trang tĩnh /phong-thuy/<năm>/ (1960 -> năm hiện tại) + bảng tra + sitemap.xml từ phong-thuy/index.html
// Chạy: node tools/build_phong_thuy.js
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, ".."), TPL = path.join(ROOT, "phong-thuy/index.html"), SITE = "https://khobienphongthuy.vn";
let tpl = fs.readFileSync(TPL, "utf8");
const js = tpl.slice(tpl.lastIndexOf("<script>") + 8, tpl.lastIndexOf("</script>"));
const lib = js.slice(js.indexOf("/* ===== Can chi"), js.indexOf("/* ===== Trạng thái"));
const { tuoi, goiY } = new Function(lib + "; return { tuoi, goiY };")();
const NOW = new Date().getFullYear(), Y0 = 1960;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Bảng tra
const rows = [];
for (let y = NOW; y >= Y0; y--) { const t = tuoi(y);
  rows.push(`<tr><td><a href="/phong-thuy/${y}/">${y}</a></td><td>${t.can} ${t.chi}</td><td>${t.napam}</td><td class="m">${t.menh}</td><td>${t.g.join(", ")}</td><td>${t.h.join(", ")}</td><td>${t.k.join(", ")}</td></tr>`); }
const bang = `<table class="bang"><thead><tr><th>Năm</th><th>Tuổi</th><th>Nạp âm</th><th>Mệnh</th><th>Số tương sinh</th><th>Số tương hợp</th><th>Số khắc</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
tpl = tpl.replace(/<!--BANG-->[\s\S]*?<!--\/BANG-->/, `<!--BANG-->${bang}<!--/BANG-->`);
fs.writeFileSync(TPL, tpl);

// Trang từng năm
const urls = [`${SITE}/`, `${SITE}/phong-thuy/`];
for (let y = Y0; y <= NOW; y++) {
  const t = tuoi(y);
  const title = `Biển số hợp tuổi ${t.can} ${t.chi} ${y}, mệnh ${t.menh} | Kho Biển Phong Thủy`;
  const desc = `Tuổi ${y} ${t.can} ${t.chi}, nạp âm ${t.napam}, mệnh ${t.menh}: tương sinh số ${t.g.join(", ")}, tương hợp ${t.h.join(", ")}, tránh ${t.k.join(", ")}. Gợi ý biển hợp tuổi theo tài chính, kèm biển đang có trong kho.`;
  const h1 = `Biển số phong thủy hợp tuổi ${t.can} ${t.chi}, mệnh ${t.menh} – biển hợp tuổi ${y}`;
  const intro = `<img src="/assets/bx/cg${t.chiI + 1}.webp" alt="Tuổi ${t.chi}" width="120" height="120"><div><p>Năm <b>${y}</b> là tuổi <b>${t.can} ${t.chi}</b>, nạp âm <b>${t.napam}</b> (${t.nghia}) – mệnh <b>${t.menh}</b>.</p><p>Theo ngũ hành, tuổi này <b>tương sinh</b> với các số <b>${t.g.join(", ")}</b>, <b>tương hợp</b> với <b>${t.h.join(", ")}</b> và <b>tương khắc</b> với <b>${t.k.join(", ")}</b>.</p><p id="exLine">Đang tìm biển hợp tuổi có sẵn trong kho…</p></div>`;
  let p = tpl
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${SITE}/phong-thuy/${y}/">\n<meta property="og:title" content="${esc(title)}">\n<meta property="og:description" content="${esc(desc)}">`)
    .replace('<h1>Xem biển số phong thủy hợp tuổi</h1>', '<h2>Xem biển số phong thủy hợp tuổi</h2>')
    .replace('<h2 class="title" id="h1y"></h2>', `<h1 class="title" id="h1y">${esc(h1)}</h1>`)
    .replace('<div class="info" id="info"></div>', `<div class="info" id="info">${intro}</div>`)
    .replace('<script src="/assets/kho-engine.js', `<script>window.NAM = ${y};</script>\n<script src="/assets/kho-engine.js`);
  fs.mkdirSync(path.join(ROOT, "phong-thuy", String(y)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "phong-thuy", String(y), "index.html"), p);
  urls.push(`${SITE}/phong-thuy/${y}/`);
}
fs.writeFileSync(path.join(ROOT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `  <url><loc>${u}</loc></url>`).join("\n")}\n</urlset>\n`);
console.log("Đã tạo", NOW - Y0 + 1, "trang năm + bảng tra + sitemap.xml");
