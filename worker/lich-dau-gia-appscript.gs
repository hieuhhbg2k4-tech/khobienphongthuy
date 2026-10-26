/* Lịch đấu giá VPA cho khobienphongthuy.vn — Google Apps Script (Web App).
   GitHub không vào được VPA (chặn IP nước ngoài) nên dùng máy chủ Google để hỏi VPA.
   Trả về JSON: { ok, updated, reg_end:{yyyymmdd: hạn ĐK (ms)}, rows:[[biển, "dd/MM/yyyy", số người ĐK, siteId]] }
   Cách cài: script.google.com -> Dự án mới -> dán file này -> Triển khai -> Tùy chọn triển khai mới -> Ứng dụng web
             (Thực thi dưới dạng: Tôi; Ai có quyền truy cập: Bất kỳ ai) -> gửi đường link /exec cho Claude. */

var API = "https://dgbs.vpa.com.vn/search-api/search/list-announcement-plan";
var PAGE = 25, DAYS = 21, BATCH = 60;

function doGet(e) {
  var days = Math.min(30, Number((e && e.parameter && e.parameter.days) || DAYS));
  var out;
  try { out = lich_(days); } catch (err) { out = { ok: false, error: String(err) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function req_(date, site, offset) {
  return { url: API, method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ offset: offset, limit: PAGE, province: "", vehicle: "", colorCode: -1, license_plate: "",
      auctionDate: date, announcementNumber: "", siteId: site }) };
}

function lich_(days) {
  var tz = "Asia/Ho_Chi_Minh", now = new Date(), plan = [], rows = {}, regEnd = {};
  // 1) Tìm các ngày có phiên đấu trong 'days' ngày tới (cả ô tô site 1 và xe máy site 2)
  var probes = [], keys = [];
  for (var k = -1; k <= days; k++) {
    var d = Utilities.formatDate(new Date(now.getTime() + k * 864e5), tz, "dd/MM/yyyy");
    [1, 2].forEach(function (site) { probes.push(req_(d, site, 0)); keys.push([d, site]); });
  }
  var first = UrlFetchApp.fetchAll(probes);
  first.forEach(function (r, j) {
    if (r.getResponseCode() !== 200) return;
    var j0 = JSON.parse(r.getContentText()), total = j0.totalElements || 0;
    if (!total) return;
    plan.push([keys[j][0], keys[j][1], total]);
    add_(rows, regEnd, j0.content, keys[j][1]);
  });
  // 2) Lấy hết các trang còn lại, chạy song song theo lô
  var list = [];
  plan.forEach(function (p) { for (var off = PAGE; off < p[2]; off += PAGE) list.push([p[0], p[1], off]); });
  for (var i = 0; i < list.length; i += BATCH) {
    var part = list.slice(i, i + BATCH);
    var res = UrlFetchApp.fetchAll(part.map(function (x) { return req_(x[0], x[1], x[2]); }));
    res.forEach(function (r, j) {
      if (r.getResponseCode() !== 200) return;
      try { add_(rows, regEnd, JSON.parse(r.getContentText()).content, part[j][1]); } catch (e) {}
    });
  }
  var arr = Object.keys(rows).map(function (b) { return rows[b]; });
  return { ok: true, updated: Utilities.formatDate(now, tz, "HH:mm dd/MM/yyyy"), plan: plan, count: arr.length, reg_end: regEnd, rows: arr };
}

function add_(rows, regEnd, content, site) {
  (content || []).forEach(function (x) {
    if (!x || !x.bks || !x.auctionDate) return;
    rows[x.bks] = [x.bks, x.auctionDate, typeof x.totalRegisteringPeople === "number" ? x.totalRegisteringPeople : -1, site];
    if (x.timeEndRegister) { var p = x.auctionDate.split("/"); regEnd[p[2] + p[1] + p[0]] = x.timeEndRegister; }
  });
}

/* Chạy thử trong trình soạn thảo: chọn hàm thuTest -> Chạy -> xem Nhật ký thực thi */
function thuTest() { var o = lich_(14); Logger.log(JSON.stringify({ count: o.count, plan: o.plan, reg_end: o.reg_end })); }
