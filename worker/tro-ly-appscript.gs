/* Trợ lý AI Kho Biển Phong Thủy — chạy trên Google Apps Script (máy chủ Google, Gemini không chặn vị trí).
   Cài đặt: Project Settings → Script properties → thêm GEMINI_API_KEY = khóa của bạn (tùy chọn GEMINI_MODEL).
   Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → chép URL /exec. */

var SYSTEM = `Bạn là "Trợ lý Kho Biển Phong Thủy", nhân viên tư vấn ảo của website khobienphongthuy.vn (hotline/Zalo 0888.188.888).
Nhiệm vụ: giúp khách tìm biển số ô tô, xe máy đẹp đang có trong kho và giải thích ý nghĩa, phong thủy của biển số.

Cách làm việc:
- Trả lời bằng tiếng Việt, thân thiện, ngắn gọn như nhân viên tư vấn thật; xưng "em", gọi khách là "anh/chị".
- Khi khách muốn tìm biển: hỏi tối đa 1 câu nếu thiếu thông tin quan trọng (tỉnh, ô tô/xe máy, tầm tiền, năm sinh); nếu đủ thì gọi công cụ tim_bien ngay. Mặc định biển Hà Nội, ô tô nếu khách không nói.
- Khi khách hỏi hợp tuổi/mệnh: gọi phong_thuy_tuoi (năm sinh dương lịch; người sinh trước Tết âm thì dùng năm trước đó), rồi gọi tim_bien với menh tương ứng.
- Khi khách hỏi về một biển cụ thể: gọi y_nghia_bien.
- CHỈ báo biển và giá lấy từ kết quả công cụ. Tuyệt đối không tự bịa biển số, giá, ngày đấu giá hay tình trạng biển. Biển "Liên hệ" thì mời khách gọi hotline để báo giá.
- Giờ vàng: 20:00–22:00 mỗi ngày giảm 5% (biển 79 tr còn 68 tr) — công cụ đã tính sẵn, chỉ nhắc lại khi có.
- Khi tìm biển, gọi tim_bien với so_luong 10 và liệt kê 8–10 biển (đủ các biển công cụ trả về), mỗi biển một dòng: 30K-668.68 – 179 tr – Lộc phát.
- Gọi công cụ càng ít càng tốt: nếu tim_bien trả về 0 biển, nới điều kiện tối đa 1 lần (ví dụ bỏ điều kiện mệnh), rồi trả lời ngay và giải thích ngắn (vd: số 6, 8 khắc mệnh Mộc nên không có đuôi 68 hợp mệnh).
- Phong thủy là quan niệm dân gian, mang tính tham khảo; không hứa hẹn tài lộc, không cam kết kết quả thủ tục hành chính.
- Muốn giữ biển, đặt cọc, hỏi hồ sơ cụ thể: mời gọi/nhắn Zalo 0888.188.888.
- Không bàn chuyện ngoài biển số/phong thủy biển số; lịch sự từ chối và quay lại chủ đề.`;

var TOOLS = [
  { name: "tim_bien", description: "Tìm biển số đang có trong kho của web, trả về biển, giá bán trên web, dạng số, tỉnh, số nút, mệnh hợp.",
    input_schema: { type: "object", properties: {
      so: { type: "string", description: "Số/mẫu cần tìm: '68686', '*68' (đuôi 68), '39*39', mẫu 'AABB', 'ABAB', hoặc đầu biển như '30K'. Bỏ trống nếu không yêu cầu." },
      tinh: { type: "string", description: "Tỉnh/thành, ví dụ 'Hà Nội', 'Hồ Chí Minh'. Chuỗi rỗng = toàn quốc." },
      loai_xe: { type: "string", enum: ["oto", "xemay", "tatca"] },
      dang_so: { type: "string", enum: ["", "Ngũ quý", "Tứ quý", "Sảnh tiến", "Tam hoa", "Lộc phát", "Thần tài", "Ông địa", "Năm sinh", "ABAB", "ABBA", "AABB", "Đối xứng", "Kép đuôi"] },
      menh: { type: "string", enum: ["", "Kim", "Mộc", "Thủy", "Hỏa", "Thổ"], description: "Chỉ lấy biển hợp mệnh này." },
      gia_tu: { type: "number", description: "Giá tối thiểu, triệu đồng." },
      gia_den: { type: "number", description: "Giá tối đa, triệu đồng." },
      tranh_so: { type: "array", items: { type: "string" }, description: "Các số cần tránh, ví dụ ['4','7','49']." },
      so_luong: { type: "integer", description: "Số biển trả về, tối đa 10." } } } },
  { name: "phong_thuy_tuoi", description: "Tra Can Chi, nạp âm, mệnh và các con số tương sinh / tương hợp / tương khắc theo năm sinh.",
    input_schema: { type: "object", properties: { nam_sinh: { type: "integer" } }, required: ["nam_sinh"] } },
  { name: "y_nghia_bien", description: "Xem một biển cụ thể: còn trong kho không, giá trên web, dạng số, số nút, hợp mệnh, ý nghĩa các con số.",
    input_schema: { type: "object", properties: { bien: { type: "string", description: "Ví dụ '30K-668.68' hoặc '30K66868'." } }, required: ["bien"] } }
];

function doGet(e) {
  if (e && e.parameter && e.parameter.models) {   // ?models=1 : xem các mô hình khóa này dùng được (không lộ khóa)
    var key = (PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "").replace(/\s+/g, "");
    var r = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, muteHttpExceptions: true });
    try { return out_({ models: (JSON.parse(r.getContentText()).models || []).filter(function (m) { return (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0; }).map(function (m) { return m.name.replace("models/", ""); }) }); }
    catch (x) { return out_({ error: r.getContentText().slice(0, 300) }); }
  }
  return out_({ ok: true, msg: "Trợ lý Kho Biển Phong Thủy đang chạy" });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || "{}");
    var msgs = (body.messages || []).slice(-30).filter(function (m) { return m && (m.role === "user" || m.role === "assistant"); })
      .map(function (m) { return typeof m.content === "string" ? { role: m.role, content: m.content.slice(0, 1500) } : m; });
    while (msgs.length && (msgs[0].role !== "user" || (Array.isArray(msgs[0].content) && msgs[0].content.some(function (c) { return c.type === "tool_result"; })))) msgs.shift();
    if (!msgs.length) return out_({ error: "Empty" });
    var props = PropertiesService.getScriptProperties();
    var key = (props.getProperty("GEMINI_API_KEY") || "").replace(/\s+/g, ""), model = (props.getProperty("GEMINI_MODEL") || "gemini-3.8-flash").trim();
    if (!key) return out_({ error: "Chưa đặt GEMINI_API_KEY" });
    var now = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "yyyy-MM-dd HH:mm");
    return out_(gemini_(key, model, msgs, SYSTEM + "\nGiờ hiện tại ở Việt Nam: " + now + "."));
  } catch (err) { return out_({ error: String(err) }); }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function cleanSchema_(s) {
  if (!s || typeof s !== "object") return s;
  if (Array.isArray(s)) return s.map(cleanSchema_);
  var o = {}; Object.keys(s).forEach(function (k) { o[k] = k === "enum" ? s[k].filter(function (x) { return x !== ""; }) : cleanSchema_(s[k]); }); return o;
}

function gemini_(key, model, msgs, system) {
  var names = {}, contents = [];
  msgs.forEach(function (m) {
    var parts = [];
    if (typeof m.content === "string") parts.push({ text: m.content });
    else m.content.forEach(function (c) {
      if (c.type === "text" && c.text) parts.push({ text: c.text });
      else if (c.type === "tool_use") { names[c.id] = c.name; var fp = { functionCall: { name: c.name, args: c.input || {} } }; if (c.sig) fp.thoughtSignature = c.sig; parts.push(fp); }
      else if (c.type === "tool_result") { var r; try { r = JSON.parse(c.content); } catch (x) { r = { ket_qua: c.content }; }
        parts.push({ functionResponse: { name: names[c.tool_use_id] || "tim_bien", response: { ket_qua: r } } }); }
    });
    if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts: parts });
  });
  var payload = JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: contents,
      tools: [{ functionDeclarations: TOOLS.map(function (t) { return { name: t.name, description: t.description, parameters: cleanSchema_(t.input_schema) }; }) }],
      generationConfig: { maxOutputTokens: 900, temperature: 0.4 } });
  // Thử lần lượt các mô hình: quá tải (503) / hết lượt miễn phí (429) / không có (404) -> chuyển mô hình khác
  var chain = [model].concat((PropertiesService.getScriptProperties().getProperty("GEMINI_FALLBACKS") || "gemini-flash-lite-latest,gemini-flash-latest,gemini-2.5-flash-lite").split(",").map(function (s) { return s.trim(); }).filter(function (s) { return s && s !== model; }));
  var res;
  for (var mi = 0; mi < chain.length; mi++) {
    res = callModel_(key, chain[mi], payload);
    var c = res.getResponseCode();
    if (c === 200 || [429, 503, 404, 500].indexOf(c) < 0) break;
  }
  var data = {}; try { data = JSON.parse(res.getContentText()); } catch (x) {}
  if (res.getResponseCode() !== 200) return { error: data.error || res.getContentText().slice(0, 300) };
  return toContent_(data);
}

function callModel_(key, model, payload) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent";
  // Thử lần lượt các cách gửi khóa (khóa AIza... và khóa mới AQ....); nhớ cách chạy được
  var props = PropertiesService.getScriptProperties(), ways = ["header", "query", "bearer"], saved = props.getProperty("KEY_MODE");
  if (saved) ways = [saved].concat(ways.filter(function (w) { return w !== saved; }));
  var res;
  for (var i = 0; i < ways.length; i++) {
    var w = ways[i], h = {}, u = url;
    if (w === "header") h["x-goog-api-key"] = key; else if (w === "bearer") h["Authorization"] = "Bearer " + key; else u = url + "?key=" + encodeURIComponent(key);
    res = UrlFetchApp.fetch(u, { method: "post", contentType: "application/json", headers: h, muteHttpExceptions: true, payload: payload });
    var code = res.getResponseCode(), txt = res.getContentText();
    if (code === 200) { if (w !== saved) props.setProperty("KEY_MODE", w); break; }
    if (!/API_KEY_INVALID|UNAUTHENTICATED|API key not valid|invalid authentication/i.test(txt)) break;   // lỗi khác (vị trí, hạn mức...) -> dừng
  }
  return res;
}

function toContent_(data) {
  var parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [], content = [];
  parts.forEach(function (p, k) {
    if (p.text) content.push({ type: "text", text: p.text });
    if (p.functionCall) { var t = { type: "tool_use", id: "g" + Date.now().toString(36) + k, name: p.functionCall.name, input: p.functionCall.args || {} }; if (p.thoughtSignature) t.sig = p.thoughtSignature; content.push(t); }
  });
  if (!content.length) content.push({ type: "text", text: "Dạ em chưa trả lời được câu này, anh/chị gọi 0888.188.888 để được tư vấn ngay ạ." });
  return { content: content };
}
