/* Trợ lý AI Kho Biển Phong Thủy — Cloudflare Worker
   Nhiệm vụ: giữ khóa API bí mật, gắn hướng dẫn + danh sách công cụ, chuyển hội thoại tới mô hình AI.
   Công cụ (tìm biển, phong thủy, ý nghĩa biển) chạy ngay trên trình duyệt của khách bằng dữ liệu kho trên web,
   nên AI chỉ báo đúng biển + đúng giá đang hiển thị.
   Biến môi trường (Secret) trong Cloudflare — chọn MỘT:
     GEMINI_API_KEY     : Google Gemini (có gói miễn phí, lấy tại aistudio.google.com)
     ANTHROPIC_API_KEY  : Claude (trả phí theo lượt)
   Tùy chọn: GEMINI_MODEL (mặc định gemini-3.8-flash). */

const MODEL = "claude-haiku-5-5";
const ALLOWED = ["https://khobienphongthuy.vn", "https://www.khobienphongthuy.vn"];
const MAX_TURNS = 30;          // số tin nhắn tối đa gửi lên mỗi lượt
const MAX_CHARS = 1500;        // độ dài tối đa một tin của khách

const SYSTEM = `Bạn là "Trợ lý Kho Biển Phong Thủy", nhân viên tư vấn ảo của website khobienphongthuy.vn (hotline/Zalo 0888.188.888).
Nhiệm vụ: giúp khách tìm biển số ô tô, xe máy đẹp đang có trong kho và giải thích ý nghĩa, phong thủy của biển số.

Cách làm việc:
- Trả lời bằng tiếng Việt, thân thiện, ngắn gọn như nhân viên tư vấn thật; xưng "em", gọi khách là "anh/chị".
- Khi khách muốn tìm biển: hỏi tối đa 1 câu nếu thiếu thông tin quan trọng (tỉnh, ô tô/xe máy, tầm tiền, năm sinh); nếu đủ thì gọi công cụ tim_bien ngay. Mặc định biển Hà Nội, ô tô nếu khách không nói.
- Khi khách hỏi hợp tuổi/mệnh: gọi phong_thuy_tuoi (năm sinh dương lịch; người sinh trước Tết âm thì dùng năm trước đó), rồi gọi tim_bien với menh tương ứng.
- Khi khách hỏi về một biển cụ thể: gọi y_nghia_bien.
- CHỈ báo biển và giá lấy từ kết quả công cụ. Tuyệt đối không tự bịa biển số, giá, ngày đấu giá hay tình trạng biển. Biển "Liên hệ" thì mời khách gọi hotline để báo giá.
- Giờ vàng: 20:00–22:00 mỗi ngày giảm 5% (biển 79 tr còn 68 tr) — công cụ đã tính sẵn, chỉ nhắc lại khi có.
- Liệt kê tối đa 5–6 biển mỗi lần, dạng: 30K-668.68 – 179 tr – Lộc phát.
- Phong thủy là quan niệm dân gian, mang tính tham khảo; không hứa hẹn tài lộc, không cam kết kết quả thủ tục hành chính.
- Muốn giữ biển, đặt cọc, hỏi hồ sơ cụ thể: mời gọi/nhắn Zalo 0888.188.888.
- Không bàn chuyện ngoài biển số/phong thủy biển số; lịch sự từ chối và quay lại chủ đề.`;

const TOOLS = [
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

function cors(origin) {
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
           "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" };
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const ok = ALLOWED.includes(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
    if (req.method === "OPTIONS") return new Response(null, { status: ok ? 204 : 403, headers: ok ? cors(origin) : {} });
    if (req.method !== "POST" || !ok) return new Response("Forbidden", { status: 403 });
    let body; try { body = await req.json(); } catch (e) { return new Response("Bad JSON", { status: 400, headers: cors(origin) }); }
    let msgs = Array.isArray(body.messages) ? body.messages.slice(-MAX_TURNS) : [];
    // Chặn tin quá dài; chỉ chấp nhận vai user/assistant
    msgs = msgs.filter(m => m && (m.role === "user" || m.role === "assistant")).map(m => {
      if (typeof m.content === "string") return { role: m.role, content: m.content.slice(0, MAX_CHARS) };
      return { role: m.role, content: m.content };
    });
    while (msgs.length && (msgs[0].role !== "user" || Array.isArray(msgs[0].content) && msgs[0].content.some(c => c.type === "tool_result"))) msgs.shift();
    if (!msgs.length) return new Response("Empty", { status: 400, headers: cors(origin) });
    const now = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
    if (env.GEMINI_API_KEY) return gemini(env, msgs, SYSTEM + `\nGiờ hiện tại ở Việt Nam: ${now}.`, origin);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system: SYSTEM + `\nGiờ hiện tại ở Việt Nam: ${now}.`, tools: TOOLS, messages: msgs })
    });
    const data = await r.text();
    return new Response(data, { status: r.status, headers: { ...cors(origin), "Content-Type": "application/json" } });
  }
};

/* ===== Google Gemini: đổi hội thoại sang định dạng Gemini và trả về đúng dạng khung chat đang dùng ===== */
function cleanSchema(s) {           // Gemini không nhận enum có chuỗi rỗng
  if (!s || typeof s !== "object") return s;
  const o = Array.isArray(s) ? s.map(cleanSchema) : {};
  if (!Array.isArray(s)) for (const [k, v] of Object.entries(s)) o[k] = k === "enum" ? v.filter(x => x !== "") : cleanSchema(v);
  return o;
}
async function gemini(env, msgs, system, origin) {
  const names = {};                 // id công cụ -> tên công cụ
  const contents = [];
  for (const m of msgs) {
    const parts = [];
    if (typeof m.content === "string") parts.push({ text: m.content });
    else for (const c of m.content) {
      if (c.type === "text" && c.text) parts.push({ text: c.text });
      else if (c.type === "tool_use") { names[c.id] = c.name; const fp = { functionCall: { name: c.name, args: c.input || {} } }; if (c.sig) fp.thoughtSignature = c.sig; parts.push(fp); }
      else if (c.type === "tool_result") { let r; try { r = JSON.parse(c.content); } catch (e) { r = { ket_qua: c.content }; }
        parts.push({ functionResponse: { name: names[c.tool_use_id] || "tim_bien", response: { ket_qua: r } } }); }
    }
    if (parts.length) contents.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents,
      tools: [{ functionDeclarations: TOOLS.map(t => ({ name: t.name, description: t.description, parameters: cleanSchema(t.input_schema) })) }],
      generationConfig: { maxOutputTokens: 900, temperature: 0.4 } })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return new Response(JSON.stringify({ error: data.error || data }), { status: r.status, headers: { ...cors(origin), "Content-Type": "application/json" } });
  const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
  const content = [];
  parts.forEach((p, k) => {
    if (p.text) content.push({ type: "text", text: p.text });
    if (p.functionCall) content.push({ type: "tool_use", id: "g" + Date.now().toString(36) + k, name: p.functionCall.name, input: p.functionCall.args || {}, ...(p.thoughtSignature ? { sig: p.thoughtSignature } : {}) });
  });
  if (!content.length) content.push({ type: "text", text: "Dạ em chưa trả lời được câu này, anh/chị gọi 0888.188.888 để được tư vấn ngay ạ." });
  return new Response(JSON.stringify({ content, stop_reason: content.some(c => c.type === "tool_use") ? "tool_use" : "end_turn" }),
    { headers: { ...cors(origin), "Content-Type": "application/json" } });
}
