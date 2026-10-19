# Bật Trợ lý AI cho khobienphongthuy.vn

Khung chat (assets/tro-ly.js) đã có trên web nhưng đang ẩn cho tới khi có địa chỉ Worker.

1. Tạo khóa API AI: vào https://console.anthropic.com → Billing (nạp tiền / gắn thẻ) → API Keys → Create Key. Giữ khóa bí mật, KHÔNG gửi qua chat.
2. Tạo Worker: https://dash.cloudflare.com → Workers & Pages → Create → Create Worker → đặt tên `tro-ly` → Deploy.
3. Edit code → xóa code mẫu → dán toàn bộ nội dung `worker/tro-ly-worker.js` → Deploy.
4. Settings → Variables and Secrets → Add → Type: Secret, Name: `ANTHROPIC_API_KEY`, Value: khóa ở bước 1 → Deploy.
5. Copy địa chỉ Worker (dạng https://tro-ly.<tên>.workers.dev), điền vào `TRO_LY_URL` trong assets/tro-ly.js → khung chat hiện lên.

Kiểm soát chi phí: đặt giới hạn chi tiêu hằng tháng trong console.anthropic.com (Limits).
Worker chỉ nhận yêu cầu từ khobienphongthuy.vn.
